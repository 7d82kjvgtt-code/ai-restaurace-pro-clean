# Obnova služby a dat

Stav ověřen 18. 10. 2026. Produkční Supabase projekt decpnnbaejxjbpmyjocs hlásí ACTIVE_HEALTHY; PostgreSQL 17.6.1.141, eu-west-1. To potvrzuje dostupnost projektu, nikoli existenci nebo obnovitelnost záloh.

## Neuzavřené body

- Poslední dokončená databázová záloha a dostupné období obnovy: nezjištěno. Dostupný konektor nemá čtení seznamu záloh; plán a zálohy z tohoto metadata výpisu nelze odvodit.
- Záloha souborů ze Storage: neověřena.
- Zkušební obnova do odděleného prostředí: neprovedena.
- Přijatelná ztráta dat (RPO) a doba obnovy (RTO): dosud nejsou se zákazníkem dohodnuty.

Tyto body se nesmějí označit jako splněné podle testů syntetické databáze, úspěšného GitHub běhu nebo stavu Ready ve Vercelu.

## Co ověřit před ostrým předáním

1. V Supabase otevřít tento projekt → Database → Backups. Zapsat čas a stav poslední dostupné zálohy, retenci a případný rozsah PITR. Nezapínat placený plán ani doplněk automaticky.
2. Pokud není použitelná záloha dostupná, připravit pravidelný export pomocí oficiálního Supabase CLI a chráněné úložiště mimo projekt. Připojení nastavit přímo v důvěryhodném prostředí; hesla a přístupové tokeny nesdílet v chatu ani v repozitáři.
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
