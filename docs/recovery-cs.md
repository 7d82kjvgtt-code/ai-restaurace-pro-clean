# Obnova služby a dat

Dokument aktualizován 21. 10. 2026; níže uvedený stav projektu ověřen 20. 10. 2026. Produkční Supabase projekt decpnnbaejxjbpmyjocs hlásí ACTIVE_HEALTHY; PostgreSQL 17.6.1.141, eu-west-1. Projekt používá Free plán a podle zobrazené stránky Backups nemá spravované projektové zálohy.

## Neuzavřené body

- Jednorázový databázový export: dokončen 20. 10. 2026 přibližně ve 12:18 Europe/Prague. Soubor restaurant-20261020-121815.dump, 609 740 bajtů; pg_dump 17.11, formát custom. Následný pg_restore --file=/dev/null přečetl celý archiv bez chyby. Nejde o test skutečné obnovy.
- Storage: staženo všech 14 objektů veřejného bucketu food-images, včetně 3 souborů v podsložce 1. Celkem 2 314 474 bajtů; ověřeny evidované velikosti, SHA-256 a čitelnost ZIPu. Databáze a soubory mají samostatné okamžiky exportu.
- Soukromý společný balíček databáze a obrázků byl vytvořen a ověřen. Samostatný databázový dump a Storage ZIP byly podle obrazovek vlastníka nahrány na Google Drive. Omezení sdílení a shoda hashů zpětně stažených kopií dosud nejsou potvrzeny; u dumpu bylo dříve zobrazeno sdílení komukoli s odkazem. Změnit na Omezeno a ověřit u obou souborů.
- Pravidelný export, retence, kontrola chyb a odpovědná osoba: dosud nezavedeny.
- Zkušební obnova schémat auth a public do oddělené místní databáze PostgreSQL 17.11 dne 20. 10. 2026: dokončena podle výstupu vlastníka. Kontrolní dotaz našel 2 restaurace, 129 rezervací a 3 uživatele. Použito --no-owner a --no-privileges s připravenými rolemi a rozšířeními; původní vlastnictví a oprávnění tím nejsou ověřena. Úplná obnova Supabase včetně Storage, Vault, Realtime, konfigurace a přihlášení aplikace zůstává neověřená.
- Přijatelná ztráta dat (RPO) a doba obnovy (RTO): dosud nejsou se zákazníkem dohodnuty.

Tyto body se nesmějí označit jako splněné podle testů syntetické databáze, úspěšného GitHub běhu nebo stavu Ready ve Vercelu.

## Změna schématu po exportu

Databázový export z 20. 10. 2026 předchází změně více restaurací z 21. 10. 2026. Při obnově této starší zálohy je nutné sladit schéma se zvolenou verzí aplikace; pro aktuální aplikaci zahrnout migraci supabase/migrations/20261021215459_multi_restaurant_context.sql. Starý dump obsahuje globální omezení jednoho aktivního členství. Nepovažovat nasazení nové funkce za vytvoření nové zálohy a neobnovovat staré unikátní indexy po vzniku více členství naslepo.

## Co ověřit před ostrým předáním

1. Jednorázový export z 20. 10. 2026 uchovat; nepovažovat jej za průběžné zálohování. Na Free plánu nejsou v tomto projektu dostupné spravované zálohy. Nezapínat placený plán ani doplněk automaticky.
2. Zavést pravidelný export a chráněné úložiště mimo projekt. První export vznikl pomocí nativního pg_dump 17.11 přes session pooler s TLS; heslo bylo zadáno v lokální výzvě. pg_dump neobsahuje globální definice rolí; doplnit samostatný export rolí bez hesel nebo ověřený postup jejich rekonstrukce. Pro přesun šifrovaných dat Vault zohlednit původní šifrovací kořenový klíč. Připojení nastavit přímo v důvěryhodném prostředí; hesla a přístupové tokeny nesdílet v chatu ani v repozitáři.
3. Samostatně zálohovat objekty Storage a jejich vazby na menu/logo. Databázová záloha obsahuje metadata, ne samotné objekty.
4. Zachovat zdrojové kódy a migrace v GitHubu. Soupis názvů potřebné konfigurace vést odděleně od hodnot tajných klíčů.
5. Před příslibem obnovitelnosti vyzkoušet obnovu v odděleném prostředí se stejnou hlavní verzí PostgreSQL. Neobnovovat produkci jako zkoušku. Případné placené prostředí musí být nejprve dohodnuto.

Export osobních údajů hostů není veřejný projektový soubor: nezapisovat jej do GitHubu, běžných CI artefaktů ani nezabezpečeného sdíleného adresáře.

## Postup při incidentu

1. Zaznamenat čas včetně pásma, rozsah dopadu a poslední fungující nasazení. Určit, zda jde o aplikaci, konfiguraci, databázi, nebo soubory.
2. Pokud mohou další zápisy zhoršovat stav, rozhodnout o dočasném zastavení příjmu rezervací a náhradním kontaktu. Neslibovat úspěšné rezervace při výpadku.
3. Uchovat aktuální stav a potřebné diagnostické podklady před návratem ke starším datům.
4. U chyby aplikace zvážit návrat na dřívější Vercel nasazení. Ten neobnovuje databázi ani fotografie; automatické přiřazování nových nasazení po rollbacku ověřit podle Vercel dokumentace.
5. U chyby dat určit konkrétní bod obnovy, chybějící rezervace po tomto bodu a dopad na všechny restaurace. Preferovat nejprve ověření na oddělené kopii.
6. Obnovu produkční databáze spustit až po výslovném rozhodnutí vlastníka se znalostí odstávky a možné ztráty novějších dat. Nepoužívat operaci obnovení pozastaveného projektu jako náhradu obnovy databázové zálohy.
7. Před návratem provozu ověřit tabulky, funkce, migrace, RLS a oprávnění; správného vlastníka a personál; rezervace a kapacity; veřejné menu a soubory Storage.
8. Ověřit evidenci doručených e-mailů před opakováním jakékoli rozesílky. Starší záloha může vrátit starší stav této evidence.
9. Až po přejímce obnovit příjem rezervací. Zapsat skutečnou dobu obnovy a ztrátu dat; upravit postup podle výsledku.

## Zdroje

- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase backup and restore using CLI: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Vercel rollback: https://vercel.com/docs/deployments/rollback
