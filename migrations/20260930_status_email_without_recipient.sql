-- Reservations without a guest email have no email delivery obligation.
CREATE OR REPLACE FUNCTION public.record_reservation_status_email_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('Potvrzeno', 'Zrušeno')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL THEN
    INSERT INTO public.reservation_status_email_deliveries
      (restaurant_id, reservation_id, status_revision, status)
    VALUES (NEW.restaurant_id, NEW.id, NEW.status_revision, NEW.status)
    ON CONFLICT (restaurant_id, reservation_id, status_revision) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_active_future_reservation_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF OLD.date >= (now() AT TIME ZONE 'Europe/Prague')::date
     AND EXISTS (SELECT 1 FROM public.restaurants WHERE id = OLD.restaurant_id) THEN
    IF OLD.status IS DISTINCT FROM 'Zrušeno' THEN
      RAISE EXCEPTION 'ACTIVE_FUTURE_RESERVATION_DELETE' USING errcode = 'P0001';
    END IF;
    IF NULLIF(btrim(OLD.email), '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.reservation_status_email_deliveries d
      WHERE d.restaurant_id = OLD.restaurant_id
        AND d.reservation_id = OLD.id
        AND d.status_revision = OLD.status_revision
        AND d.status = 'Zrušeno'
        AND d.sent_at IS NULL
    ) THEN
      RAISE EXCEPTION 'PENDING_CANCELLATION_EMAIL' USING errcode = 'P0001';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;
