# Stav dokončení a spuštění

Aktualizováno 2. 11. 2026. Tento soupis odděluje implementaci od skutečné provozní přejímky. Není potvrzením, že je uzavřený celý obchodní nebo MASTER rozsah.

| Oblast | Stav a důkaz | Co zbývá |
| --- | --- | --- |
| CZ/EN administrace | Doplněné dynamické seznamy, provozní hlášky, grafy, export, tým a přijetí pozvánky. Commit 1631a871142ca352b2b5a159588526834b4f227c; Actions 41515011625 úspěšné, Vercel úspěšný. Nasazená stránka pozvánky přepne texty i chybový stav do angličtiny bez obnovení stránky. | Přejímka skutečně přihlášeným vlastníkem/personálem v obou jazycích. Neznámé technické zprávy z externích služeb zachovávají původní text. |
| Více restaurací a role | Výběr podniku, samostatná oprávnění a idempotentní vytvoření dalšího podniku jsou nasazené. Testy ověřují i kombinaci vlastník A / obsluha B. | Skutečný průchod přihlášeným účtem se dvěma podniky. |
| Rezervace a izolace dat | Plná sada současných regresí prošla. Syntetické testy zahrnují 100 podniků / 100 000 rezervací a souběh handleru s nahrazeným databázovým přenosem. | Přejímka konkrétního zákazníka a případná skutečná dlouhodobá zátěž. Tyto testy nejsou certifikací kapacity hostingu. |
| Databázová ochrana | Čtení metadat produkce 2. 11. 2026: PostgreSQL 17.6, 18 tabulek v public, žádná bez RLS, migrace více restaurací přítomná. | Poradce stále uvádí dříve posouzené SECURITY DEFINER funkce a vypnutou ochranu uniklých hesel. Neprohlašovat všechny bezpečnostní položky za vyřešené. |
| Pravidelné zálohy | Implementovaný export databáze/rolí/Storage do šifrovaného restic repozitáře, kontrola hashů po zpětném stažení a macOS instalátor. Skutečný restic ověřen lokálně pouze se syntetickým obsahem. | Zvolit a nakonfigurovat soukromý cíl; bezpečně nastavit lokální přístupy; provést první skutečný export, aktivovat plán a ověřit plánovaný běh. Stanovit odpovědnou osobu, upozornění a retenci. |
| Úplná obnova | Původní export 20. 10. 2026 byl čitelný a auth/public byly dříve místně obnovené. | Nová úplná obnova v odděleném prostředí včetně rolí, rozšíření, RLS, Storage, Auth a nastavení služby. Kontrola archivu ji nenahrazuje. |
| Platby a tarify | Automatické účtování není implementované ani aktivované. | Chybí potvrzená cena, obsah tarifu a propojený účet poskytovatele plateb. Nezakládat poplatky ani neodhadovat zákaznické ceny. |
| AI | Dostupný kód zůstává záměrně vypnutý; testy ověřují, že se nevolá placený provider. | Konkrétní schválený rozsah AI a povolený poskytovatel/rozpočet. Žádný placený plán ani API se automaticky nezapíná. |
| První zákazník | Existuje postup předání v pilot-handover-cs.md. | Skutečné podklady podniku, dohodnuté přístupy a přejímka s odpovědnou osobou. |

## Nejbližší potřebné vstupy

1. Cena a obsah měsíčního tarifu za jednu restauraci; případné zkušební období.
2. Soukromý cíl záloh a prostředí, které je bude pravidelně spouštět. Přístupové údaje nastavit přímo v důvěryhodném prostředí, neposílat je v chatu.
3. Dokončení přihlášené přejímky v účtu vlastníka a personálu. Bez ní nelze potvrdit celý soukromý uživatelský průchod.

Není podložený závazný zbývající čas „30 hodin“. Další práce závisí i na těchto obchodních a přístupových vstupech.

Podrobnosti: [jazyky administrace](admin-language.md), [pravidelné zálohy](automated-backup-cs.md), [obnova](recovery-cs.md), [předání pilotu](pilot-handover-cs.md).
