-- Deploy the matching dashboard and invitation endpoint before applying this migration.
-- Existing per-restaurant uniqueness, RLS and last-owner protections remain in force.
DROP INDEX IF EXISTS public.restaurant_team_one_active_user_uidx;
DROP INDEX IF EXISTS public.restaurant_team_one_active_email_uidx;

-- Legacy implicit helpers fail closed for accounts with several memberships.
CREATE OR REPLACE FUNCTION public.current_restaurant_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT min(rt.restaurant_id) FROM public.restaurant_team rt
  WHERE rt.user_id = auth.uid() AND rt.active = true
  HAVING count(*) = 1;
$$;

CREATE OR REPLACE FUNCTION public.current_restaurant_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT min(lower(rt.role)) FROM public.restaurant_team rt
  WHERE rt.user_id = auth.uid() AND rt.active = true
  HAVING count(*) = 1;
$$;

CREATE OR REPLACE FUNCTION public.multi_restaurant_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT auth.uid() IS NOT NULL; $$;
REVOKE ALL ON FUNCTION public.multi_restaurant_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.multi_restaurant_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_additional_owner_restaurant(p_name text, p_request_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_id bigint;
  v_existing_name text;
  v_name text := btrim(p_name);
  v_slug text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '28000';
  END IF;
  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 120 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid restaurant request' USING errcode = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  SELECT lower(email) INTO v_email FROM auth.users
  WHERE id = v_user_id AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirmed email required' USING errcode = '28000';
  END IF;
  v_slug := 'restaurace-' || replace(v_user_id::text, '-', '') || '-' || replace(p_request_id::text, '-', '');
  SELECT id, name INTO v_id, v_existing_name FROM public.restaurants WHERE slug = v_slug;
  IF FOUND THEN
    IF NOT public.is_restaurant_owner(v_id) THEN
      RAISE EXCEPTION 'Active owner access required' USING errcode = '42501';
    END IF;
    IF v_existing_name IS DISTINCT FROM v_name THEN
      RAISE EXCEPTION 'Request already used for another name' USING errcode = '22023';
    END IF;
    RETURN v_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurant_team
                 WHERE user_id = v_user_id AND active AND lower(role) = 'owner') THEN
    RAISE EXCEPTION 'Active owner access required' USING errcode = '42501';
  END IF;
  IF (SELECT count(*) FROM public.restaurant_team WHERE user_id = v_user_id AND active) >= 100 THEN
    RAISE EXCEPTION 'Restaurant membership limit reached' USING errcode = '54000';
  END IF;
  INSERT INTO public.restaurants(name, slug, is_published)
  VALUES(v_name, v_slug, false) RETURNING id INTO v_id;
  INSERT INTO public.restaurant_team(restaurant_id, user_id, email, full_name, role, active, joined_at)
  VALUES(v_id, v_user_id, v_email, '', 'owner', true, now());
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_additional_owner_restaurant(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_additional_owner_restaurant(text, uuid) TO authenticated;
