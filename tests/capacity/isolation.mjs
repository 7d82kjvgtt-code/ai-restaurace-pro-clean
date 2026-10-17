import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const schema=JSON.parse(fs.readFileSync(new URL('./schema-snapshot.json',import.meta.url)));
const db=new PGlite();
const q=x=>'"'+x.replaceAll('"','""')+'"';
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
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
// Only synthetic fixtures. Seed before installing triggers; all triggers are enabled for assertions.
await db.exec(`INSERT INTO auth.users SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'owner'||i||'@example.invalid' FROM generate_series(1,100) i;
 INSERT INTO restaurants(id,name,slug,is_published) OVERRIDING SYSTEM VALUE SELECT i,'Fixture '||i,'fixture-'||i,true FROM generate_series(1,100) i;
 INSERT INTO restaurant_team(restaurant_id,user_id,email,role,active) SELECT i,('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'owner'||i||'@example.invalid','owner',true FROM generate_series(1,100) i;
 INSERT INTO profiles(id,restaurant_id,role) SELECT id,substring(email from '[0-9]+')::bigint,'owner' FROM auth.users;
 INSERT INTO restaurant_tables(id,restaurant_id,name,capacity) SELECT i,i,'Table '||i,4 FROM generate_series(1,100) i;
 INSERT INTO menu(restaurant_id,name,price,category) SELECT i,'Private menu '||i,200,'Main' FROM generate_series(1,100) i;
 INSERT INTO reservation_settings(restaurant_id) SELECT i FROM generate_series(1,100) i;
 INSERT INTO opening_hours(restaurant_id,day_of_week) SELECT i,d FROM generate_series(1,100) i CROSS JOIN generate_series(0,6) d;
 INSERT INTO customer_profiles(restaurant_id,customer_key,name,email) SELECT i,'fixture-'||i,'Guest '||i,'guest'||i||'@example.invalid' FROM generate_series(1,100) i;
 INSERT INTO reservations(restaurant_id,name,people,date,time,table_id,status) SELECT i,'Guest '||i,2,DATE '2020-01-01'+n,'12:00',i,'Potvrzeno' FROM generate_series(1,100) i CROSS JOIN generate_series(0,999) n;
 ANALYZE;`);
for(const t of schema.triggers)await db.exec(t);
console.log('Recreated production tables, constraints, policies, functions and triggers; 100 restaurants / 100,000 synthetic reservations.');
let assertions=0;const duration=[];
const check=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
for(const role of ['anon','authenticated']) {
 const rights=(await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (has_table_privilege($1,c.oid,'TRUNCATE') OR has_table_privilege($1,c.oid,'TRIGGER') OR has_table_privilege($1,c.oid,'REFERENCES'))",[role])).rows[0].n;
 check(rights,0);
}
async function rejected(sql,params){try{await db.query(sql,params);}catch(e){check(['42501','23514','23503'].includes(e.code),true);return;}throw Error('Unauthorized write succeeded');}
async function blockedOrEmpty(sql,params){try{check((await db.query(sql,params)).rows.length,0);}catch(e){if(e.code==='42501')assertions++;else throw e;}}
for(let tenant=1;tenant<=100;tenant++){
 const foreign=tenant===100?1:tenant+1;
 await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-4000-8000-${String(tenant).padStart(12,'0')}'; SET request.jwt.claim.role='authenticated';`);
 const start=performance.now();
 for(const table of ['reservations','menu','restaurant_tables','reservation_settings','opening_hours','customer_profiles','restaurant_team']){
  const rows=(await db.query(`SELECT DISTINCT restaurant_id::int FROM ${q(table)} WHERE restaurant_id IN ($1,$2)`,[tenant,foreign])).rows;
  check(rows,[{restaurant_id:tenant}]);
 }
 check((await db.query('SELECT count(*)::int AS n FROM reservations WHERE restaurant_id=$1',[tenant])).rows[0].n,1000);
 check((await db.query('SELECT count(*)::int AS n FROM reservations WHERE restaurant_id=$1',[foreign])).rows[0].n,0);
 await blockedOrEmpty("UPDATE reservations SET note='ATTACK' WHERE restaurant_id=$1 RETURNING id",[foreign]);
 await blockedOrEmpty('DELETE FROM menu WHERE restaurant_id=$1 RETURNING id',[foreign]);
 await rejected("INSERT INTO menu(restaurant_id,name,price) VALUES($1,'ATTACK',1)",[foreign]);
 await rejected('UPDATE menu SET restaurant_id=$1 WHERE restaurant_id=$2',[foreign,tenant]);
 await rejected("INSERT INTO reservations(restaurant_id,name,people,date,time,table_id) VALUES($1,'ATTACK',2,'2090-01-01','12:00',$2)",[tenant,foreign]);
 check((await db.query("UPDATE menu SET description='Authorized' WHERE restaurant_id=$1 RETURNING id",[tenant])).rows.length,1);
 duration.push(performance.now()-start);
 if(tenant%10===0)console.log('Verified tenant',tenant);
 await db.exec('RESET ROLE;');
}
await db.exec("SET ROLE anon; SET request.jwt.claim.sub=''; SET request.jwt.claim.role='anon';");
for(const table of ['reservations','customer_profiles','restaurant_team','reservation_history']){
 try {check((await db.query(`SELECT count(*)::int AS n FROM ${q(table)}`)).rows[0].n,0);}
 catch(e){if(e.code==='42501')assertions++;else throw e;}
}
await db.exec('RESET ROLE;');
const sorted=duration.toSorted((a,b)=>a-b);
const result={pass:true,engine:(await db.query('select version()')).rows[0].version,restaurants:100,reservations:100000,assertions,tenantMatrixMs:{p50:sorted[49],p95:sorted[94],max:sorted.at(-1)},limitation:'Embedded single-connection PostgreSQL. These timings do not certify hosted Supabase/Vercel capacity or connection concurrency.'};
fs.writeFileSync(new URL('./isolation-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await db.close();
