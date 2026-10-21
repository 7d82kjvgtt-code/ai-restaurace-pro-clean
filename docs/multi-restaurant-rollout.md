# Více restaurací pod jedním účtem

Implementace z 21. 10. 2026 zahrnuje výběr restaurace, její další založení a ověřování role pro konkrétní podnik v pozvánkách. Nové založení se v administraci nabízí pouze po dostupnosti databázové funkce multi_restaurant_enabled().

## Stav nasazení a kontrol

- Aplikace: commit 349315ccd2546e4a46f1168f8adf17bbf4903783; Vercel nasazení AgM4wBqwm4bB4r2XSEwqHdXFaLaP úspěšné. Produkční dashboard.js a restaurant-context.js mají stejné SHA-256 jako ověřený zdroj.
- GitHub Actions 39684313693: všechny kroky úspěšné, včetně původní regresní sady, 53 kontrol nového UI, 29 databázových kontrol a 25 scénářů endpointu pozvánek.
- Produkční databázová změna provedena v transakci přes execute_sql po dvou technických chybách relace nástroje apply_migration. Před opakováním byl potvrzen nezměněný stav databáze. Verze 20261021215459 a přesné SQL byly zaznamenány do supabase_migrations.schema_migrations ve stejné transakci.
- Následná kontrola potvrdila odstranění dvou globálních indexů, zachování obou UNIQUE omezení v rámci podniku, triggeru posledního majitele a RLS na všech veřejných tabulkách. EXECUTE nové zakládací funkce: anon false, authenticated true.
- Obě nové RPC přes skutečné HTTP odmítly nepřihlášeného klienta stavem 401. Read-only test na produkčním PostgreSQL s neexistující syntetickou identitou potvrdil nulový přístup k rezervacím, týmu a CRM a odmítnutí založení bez ověřeného účtu. Celý test byl vrácen ROLLBACKem; nevznikly testovací podniky ani pozvánky.
- Poradce přidal očekávané upozornění na novou SECURITY DEFINER funkci dostupnou authenticated; omezení EXECUTE, prázdný search_path a vnitřní kontroly jsou ověřené. Ostatní skupiny upozornění zůstaly stejné, nejde o prohlášení, že projekt nemá žádná bezpečnostní upozornění.
- Produkční přihlašovací stránka se načetla bez chyby aplikace. Skutečný průchod přihlášeného účtu se dvěma restauracemi v prohlížeči dosud není potvrzen.

## Chování

- Jedno aktivní členství se otevře automaticky. Více členství vyžaduje výběr; zapamatovaný výběr je v sessionStorage vázaný na uživatele.
- Přepnutí upozorní na neuloženou práci, zneplatní relaci starých požadavků a načte stránku znovu. Odebrání přístupu a přechod na jiný podnik také vyvolají nové načtení.
- Název i role v přepínači pocházejí z aktivního členství. Výběr v prohlížeči není oprávnění: všechny politiky nadále ověřují členství a roli pro cílové restaurant_id.
- Další podnik může založit jen účet s potvrzeným e-mailem a aktivní rolí owner alespoň v jedné restauraci. Zůstává neveřejný. Limit je 100 aktivních členství na účet.
- Založení má UUID požadavku a transakční zámek uživatele. Opakování stejného požadavku vrátí stejný podnik; rozepsaný požadavek se uchovává pro ověření po výpadku.
- Pozvánka obsahuje cílové restaurant_id. Server ověřuje aktivní roli owner právě v tomto podniku. Starý klient bez ID funguje jen s jednoznačným jediným členstvím.
- U existujícího účtu zjištěného přes členství se před přidáním ověří ID, e-mail a jeho potvrzení v Auth. Nevytváří se druhý účet ani nové heslo. Nový uživatel prochází dosavadní e-mailovou pozvánkou.
- Legacy profiles zůstává pouze kompatibilní kopií; nepoužívá se jako důkaz role. Pomocné current_restaurant_id/role vracejí pro více aktivních členství NULL.

## Databáze a pořadí nasazení

Migrace: supabase/migrations/20261021215459_multi_restaurant_context.sql, vytvořená Supabase CLI.

1. Nasadit dashboard, restaurant-context.js a aktualizovaný endpoint pozvánek. Tlačítko přidání je bez nové databázové funkce skryté.
2. Po úspěšných kontrolách použít celou migraci v transakci. Ta odstraní pouze dva globální indexy omezující účet/e-mail na jeden podnik. UNIQUE (restaurant_id, user_id), UNIQUE (restaurant_id, email), RLS a ochrana posledního majitele zůstávají.
3. Ověřit funkce, jejich oprávnění a poradce. Založení je SECURITY DEFINER s prázdným search_path, kontrolou auth.uid(), potvrzeného e-mailu a aktivního majitele. EXECUTE mají jen authenticated; PUBLIC a anon jsou odebrány. Upozornění poradce na dostupnou privilegovanou funkci je z tohoto důvodu záměrně posouzené, ne vyřešené odstraněním kontroly.
4. Při přejímce v přihlášeném prohlížeči ověřit dva vlastní podniky a účet s rolí owner v A a staff v B. Tato přejímka není nahrazena offline testy.

## Ověření

- multi-restaurant-db.mjs aplikuje skutečnou migraci na rekonstruované tabulky, pravidla, funkce a triggery. Ověřuje přístupy napříč podniky s různými rolemi, zákaz zvýšení role, posledního majitele, potvrzený e-mail, opakování založení, cizí účet a limit členství. Používá pouze syntetická data a embedded PostgreSQL; není testem skutečné kapacity hostovaného prostředí ani přihlášení Supabase Auth.
- multi-restaurant-ui.mjs ověřuje výběr vázaný na účet, zapamatování, odmítnutí neznámého podniku, zrušené přepnutí, změnu přístupu, dvojí kliknutí a opakování po nejistém výsledku.
- invite-boundaries.mjs ověřuje autorizaci cílové restaurace, ověření existujícího účtu a odmítnutí vadných odpovědí. E-maily se v testech neodesílají.
- Stávající regresní kontroly zůstávají v npm test --prefix tests/capacity a v GitHub Actions.

## Návrat při potížích

Neobnovovat globální unikátní indexy naslepo: po vzniku dalších členství už nemusí být splnitelné. Zastavení dalšího zakládání lze provést vrácením false z multi_restaurant_enabled() a odebráním EXECUTE na create_additional_owner_restaurant(text,uuid) roli authenticated. Existující členství i možnost výběru ponechat funkční. Žádné podniky ani členství při návratu automaticky nemazat.

Supabase funkce a oprávnění: https://supabase.com/docs/guides/database/functions
RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
Upozornění na privilegované funkce: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
