import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const schema=JSON.parse(fs.readFileSync(new URL('./schema-snapshot.json',import.meta.url)));
const db=new PGlite();
const q=x=>'"'+x.replaceAll('"','""')+'"';
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('sub',auth.uid(),'role',auth.role()) $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 SET check_function_bodies=off;`);
for(const name of [...new Set(schema.columns.map(c=>c.table))]) {
 const cols=schema.columns.filter(c=>c.table===name).map(c=>`${q(c.column)} ${c.type}${c.identity?' GENERATED '+(c.identity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY':c.default?' DEFAULT '+c.default:''}${c.notnull?' NOT NULL':''}`);
 await db.exec(`CREATE TABLE public.${q(name)} (${cols.join(',')}); ALTER TABLE public.${q(name)} ENABLE ROW LEVEL SECURITY;`);
}
for(const f of schema.functions) await db.exec(f);
for(const con of [...schema.constraints.filter(c=>c.type!=='f' && c.type!=='t'),...schema.constraints.filter(c=>c.type==='f')])
 await db.exec(`ALTER TABLE public.${q(con.table)} ADD CONSTRAINT ${q(con.name)} ${con.def};`);
const constraintIndexes=new Set(schema.constraints.filter(c=>['p','u'].includes(c.type)).map(c=>c.name));
for(const idx of schema.indexes) {
 const name=idx.match(/INDEX (\S+) ON/)[1].replaceAll('"','');
 if(!constraintIndexes.has(name)) await db.exec(idx);
}
for(const p of schema.policies) await db.exec(`CREATE POLICY ${q(p.policyname)} ON public.${q(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(q).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`);
for(const g of schema.grants) await db.exec(`GRANT ${g.privilege_type} ON public.${q(g.table_name)} TO ${q(g.grantee)};`);
await db.exec(fs.readFileSync(new URL('../../migrations/20261017222030_restrict_client_table_maintenance.sql',import.meta.url),'utf8'));
await db.exec('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,service_role;');

await db.exec(fs.readFileSync(new URL('../../supabase/migrations/20261021215459_multi_restaurant_context.sql',import.meta.url),'utf8'));
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
await db.exec(`INSERT INTO auth.users SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'fixture'||i||'@example.invalid',CASE WHEN i=5 THEN NULL ELSE now() END FROM generate_series(1,6)i;
 INSERT INTO restaurants(id,name,slug,is_published) OVERRIDING SYSTEM VALUE SELECT i,'Private fixture '||i,'multi-fixture-'||i,false FROM generate_series(1,4)i;
 INSERT INTO restaurant_team(restaurant_id,user_id,email,role,active) VALUES
 (1,'${uid(1)}','fixture1@example.invalid','owner',true),
 (2,'${uid(2)}','fixture2@example.invalid','owner',true),
 (2,'${uid(1)}','fixture1@example.invalid','staff',true),
 (1,'${uid(3)}','fixture3@example.invalid','manager',true),
 (2,'${uid(3)}','fixture3@example.invalid','staff',true),
 (3,'${uid(2)}','fixture2@example.invalid','owner',true),
 (3,'${uid(5)}','fixture5@example.invalid','owner',true),
 (4,'${uid(2)}','fixture2@example.invalid','owner',true),
 (4,'${uid(6)}','fixture6@example.invalid','owner',false);
 INSERT INTO menu(restaurant_id,name,price) SELECT i,'Private dish '||i,200 FROM generate_series(1,4)i;
 INSERT INTO restaurant_tables(id,restaurant_id,name,capacity) SELECT i,i,'Table '||i,4 FROM generate_series(1,4)i;
 INSERT INTO reservations(restaurant_id,name,people,date,time,table_id,status) SELECT i,'Local fixture',2,'2030-01-15','12:00',i,'Potvrzeno' FROM generate_series(1,4)i;
 SELECT setval(pg_get_serial_sequence('public.restaurants','id'),100,true);`);
for(const trigger of schema.triggers) await db.exec(trigger);
let assertions=0;
function check(actual,expected){assert.deepEqual(actual,expected);assertions++;}
async function asUser(n){await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='${uid(n)}'; SET request.jwt.claim.role='authenticated';`);}
async function denied(sql,params,code='42501') {try{await db.query(sql,params);}catch(e){check(e.code,code);return;}throw new Error('Expected rejection: '+sql);}
await asUser(1);
check((await db.query('SELECT DISTINCT restaurant_id::int FROM reservations ORDER BY 1')).rows,[{restaurant_id:1},{restaurant_id:2}]);
check((await db.query('SELECT id::int FROM restaurants ORDER BY 1')).rows,[{id:1},{id:2}]);
check((await db.query('SELECT current_restaurant_id() AS id,current_restaurant_role() AS role')).rows,[{id:null,role:null}]);
check((await db.query("INSERT INTO menu(restaurant_id,name,price) VALUES(1,'Allowed',100) RETURNING id")).rows.length,1);
await denied("INSERT INTO menu(restaurant_id,name,price) VALUES(2,'Rejected',100)");
check((await db.query("UPDATE menu SET description='Allowed' WHERE restaurant_id=1 RETURNING id")).rows.length,2);
check((await db.query("UPDATE menu SET description='Rejected' WHERE restaurant_id=2 RETURNING id")).rows.length,0);
check((await db.query("UPDATE restaurant_team SET role='owner' WHERE restaurant_id=2 AND user_id=$1 RETURNING id",[uid(1)])).rows.length,0);
await denied('DELETE FROM restaurant_team WHERE restaurant_id=1 AND user_id=$1',[uid(1)],'23514');
check((await db.query('SELECT count(*)::int AS n FROM restaurant_team WHERE restaurant_id=1 AND role=$1',['owner'])).rows[0].n,1);
const request='00000000-0000-4000-8000-000000000010';
const created=(await db.query('SELECT create_additional_owner_restaurant($1,$2) AS id',['Additional fixture',request])).rows[0].id;
check((await db.query('SELECT create_additional_owner_restaurant($1,$2) AS id',['Additional fixture',request])).rows[0].id,created);
check((await db.query('SELECT is_published FROM restaurants WHERE id=$1',[created])).rows,[{is_published:false}]);
check((await db.query('SELECT role FROM restaurant_team WHERE restaurant_id=$1 AND user_id=$2',[created,uid(1)])).rows,[{role:'owner'}]);
await denied('SELECT create_additional_owner_restaurant($1,$2)',['Changed name',request],'22023');
await denied('SELECT create_additional_owner_restaurant($1,$2)',['X',request],'22023');
await asUser(2);
const other=(await db.query('SELECT create_additional_owner_restaurant($1,$2) AS id',['Other owner fixture',request])).rows[0].id;
check(created!==other,true);
check((await db.query('SELECT count(*)::int AS n FROM reservations WHERE restaurant_id=1')).rows[0].n,0);
await asUser(3);
check((await db.query('SELECT DISTINCT restaurant_id::int FROM reservations ORDER BY 1')).rows,[{restaurant_id:1},{restaurant_id:2}]);
check((await db.query("INSERT INTO menu(restaurant_id,name,price) VALUES(1,'Manager allowed',100) RETURNING id")).rows.length,1);
await denied("INSERT INTO menu(restaurant_id,name,price) VALUES(2,'Staff rejected',100)");
await denied('SELECT create_additional_owner_restaurant($1,$2)',['Forbidden fixture',request]);
await asUser(4);
check((await db.query('SELECT count(*)::int AS n FROM reservations')).rows[0].n,0);
await denied('SELECT create_additional_owner_restaurant($1,$2)',['Forbidden fixture',request]);
await asUser(5);
await denied('SELECT create_additional_owner_restaurant($1,$2)',['Unconfirmed fixture',request],'28000');
await asUser(6);
await denied('SELECT create_additional_owner_restaurant($1,$2)',['Inactive fixture',request]);
await db.exec("RESET ROLE; SET request.jwt.claim.role='service_role';");
check((await db.query("SELECT has_function_privilege('anon','public.create_additional_owner_restaurant(text,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false);
check((await db.query("SELECT has_function_privilege('anon','public.multi_restaurant_enabled()','EXECUTE') AS allowed")).rows[0].allowed,false);
// Users with only one active membership retain the legacy helper behavior.
await db.query('INSERT INTO restaurant_team(restaurant_id,user_id,email,role,active) VALUES(4,$1,$2,$3,true)',[uid(4),'fixture4@example.invalid','staff']);
await asUser(4);
check((await db.query('SELECT current_restaurant_id()::int AS id,current_restaurant_role() AS role')).rows,[{id:4,role:'staff'}]);
await db.exec("RESET ROLE; SET request.jwt.claim.role='service_role';");
// Exercise the explicit 100-membership ceiling with synthetic data only.
await db.exec(`INSERT INTO restaurants(id,name,slug,is_published) OVERRIDING SYSTEM VALUE SELECT i,'Limit fixture '||i,'limit-fixture-'||i,false FROM generate_series(201,297)i;
 INSERT INTO restaurant_team(restaurant_id,user_id,email,role,active) SELECT i,'${uid(1)}','fixture1@example.invalid','staff',true FROM generate_series(201,297)i;`);
await asUser(1);
await denied('SELECT create_additional_owner_restaurant($1,$2)',['Limit fixture','00000000-0000-4000-8000-000000000020'],'54000');
console.log(`PASS ${assertions} multi-restaurant database assertions: actual migration, RLS across mixed roles, idempotent creation, confirmed email, membership ceiling and last-owner trigger. Embedded PostgreSQL, no hosted load certification.`);
await db.close();
