# Pravidelné šifrované zálohy

Stav k 2. 11. 2026: exportní program, kontrola zpětného stažení a instalátor plánování jsou implementované a otestované. Produkční plánovač zde není aktivovaný. Chybí zvolené soukromé úložiště, jeho konfigurace a bezpečně nastavené lokální přístupy. Žádný placený plán ani nové úložiště se nezřizovalo.

## Co program dělá

`scripts/backup-restaurant.py` používá PostgreSQL 17 a existující šifrovaný repozitář restic. Přes libpq service a soubor pgpass provede databázový export ve formátu custom, export rolí bez databázových hesel a export všech evidovaných objektů Storage. Záloha zahrnuje databázi včetně auth/public a metadata ostatních schémat; sama nezajišťuje přenos Vault kořenových klíčů, nastavení Supabase projektu, přihlašovacích providerů ani tajných hodnot konfigurace aplikace.

- Exportní připojení má nastavené `default_transaction_read_only=on`; program neobnovuje ani nemaže produkční data a neposílá e-maily.
- Veřejné obrázky stáhne z veřejných URL. U soukromých objektů vyžaduje serverový klíč v chráněném souboru mimo repozitář.
- Porovná Storage inventář před a po exportu. Změna objektů během exportu znamená neúspěch; nevytváří se přijatá záloha s neověřenými obrázky. Databáze má vlastní konzistentní snapshot pg_dump; Storage API není atomický databázový snapshot.
- Ověří velikosti stažených souborů a uloží SHA-256 manifest.
- Archiv odešle do šifrovaného restic repozitáře, stáhne zpět právě vytvořený snapshot a porovná všechny soubory s manifestem. Obě kopie dumpu celé přečte pomocí pg_restore.
- Teprve po úspěšné kontrole atomicky zapíše `last-verified-backup.json` vedle soukromé konfigurace. Při chybě předchozí úspěšný checkpoint nepřepisuje.
- Tajné hodnoty ani serverové chyby nevypisuje do běžného výstupu. Dočasné nešifrované exporty jsou v soukromém pracovním adresáři a po běhu se odstraní.
- Nevytváří úložiště automaticky a nemaže staré snapshoty. Retenci a upozornění odpovědné osobě je nutné výslovně nastavit po volbě cílového úložiště.

Úspěšná kontrola šifrovaného exportu není úplná obnova Supabase. Pokud selže zpětné ověření po zápisu do restic, může tam zůstat neověřený snapshot. Při obnově vybírat konkrétní ID z posledního úspěšného checkpointu, nikoli slepě `latest`.

## Jednorázové dokončení na Macu

1. Zvolit soukromé úložiště mimo původní Supabase projekt a mimo zdrojový repozitář. Místní adresář na stejném Macu sám o sobě není bezpečná kopie mimo zařízení. Stávající účet lze použít, pokud má vhodný podporovaný přístup; žádnou placenou službu nepřidávat bez rozhodnutí vlastníka.
2. Mít Python 3.9+, klienty PostgreSQL 17 z Postgres.app a restic 0.18.1 nebo novější. CI test používá přesně ověřený restic 0.18.1; jeho stažení i SHA-256 jsou připnuté ve workflow.
3. Soukromou konfiguraci uložit např. do `~/Library/Application Support/AI-Restaurace-Backup/`. Zkopírovat sem a doplnit vzor `scripts/backup-config.example.json` a `scripts/backup-pg-service.example.conf`. Tyto skutečné soubory musí patřit aktuálnímu uživateli a mít oprávnění 600. Konfigurační vzory v GitHubu neobsahují hesla.
4. Heslo databáze nastavit přímo na důvěryhodném Macu do samostatného souboru pgpass ve standardním formátu `host:port:database:user:password`. Použít session pooler na portu 5432, nikoli transaction pooler. Heslo ani serverový klíč neposílat do chatu. Heslo restic uchovat také odděleně pro případ ztráty Macu; bez něj je šifrovaná kopie neobnovitelná.
5. V cílovém důvěryhodném prostředí jednorázově připravit restic repozitář a jeho přístup podle dokumentace daného backendu. Program úmyslně neprovádí `restic init` do odhadnutého cíle.
6. Ověřit lokální konfiguraci příkazem `python3 scripts/backup-restaurant.py --config "/cesta/k/soukrome/config.json" --check-config`.
7. Spustit první export a zkontrolovat výsledek `ok: true` i checkpoint. Až potom instalovat plánovač příkazem `python3 scripts/install-backup-schedule.py --config "/cesta/k/soukrome/config.json"`. Instalátor sám provede a ověří nový export, než vytvoří novou úlohu; existující úlohu nepřepisuje.

Mac plánuje běh každý den ve 03:20 svého místního času. Musí být dostupný, přihlášený a mít připojení. Pokud Mac spí nebo je vypnutý, nelze slibovat pevné RPO. Pro nezávislé každodenní zálohy použít stálé důvěryhodné prostředí se stejným programem a odpovídajícím plánovačem; jeho přístupy zatím nejsou nastavené.

Výstupy plánovače jsou v `~/Library/Logs/AI-Restaurace-Backup/`. Převzetí odpovědnosti za kontroly, upozorňování při chybě, konkrétní retenci, RPO a RTO není tímto kódem dohodnuto.

## Ověření a omezení

Testy ověřují odmítnutí nebezpečných cest a kolizí názvů, oprávnění tajných souborů, nezveřejnění chyb se syntetickým tajemstvím, odmítnutí změněného Storage a poškozeného archivu. Instalátor nesmí zapnout plánování bez úspěšně ověřeného exportu ani přepsat existující úlohu.

Skutečný restic 0.18.1 byl vyzkoušen proti místnímu šifrovanému repozitáři: syntetický dump a obrázek prošly zápisem, zpětným stažením a porovnáním hashů. Databázové klienty a Storage v tomto testu nahrazují lokální fixture. Nejde o nový export produkce ani o potvrzení plné obnovy databáze nebo provozu macOS plánovače.

Další nutná přejímka: první skutečný export do zvoleného cíle, opakovaný plánovaný běh a obnova do odděleného prostředí se správnými rolemi, rozšířeními, RLS, Storage a funkčním přihlášením aplikace. Produkci nepoužívat jako test obnovy.

## Dokumentace

- https://supabase.com/docs/guides/platform/backups
- https://www.postgresql.org/docs/17/app-pg-dumpall.html
- https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- https://restic.readthedocs.io/en/stable/040_backup.html
