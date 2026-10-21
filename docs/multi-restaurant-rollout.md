# Více restaurací pod jedním účtem

Stav kontroly: 21. 10. 2026. Funkce zatím není implementována ani zapnuta. Produkční databáze byla v této kontrole pouze čtena; žádná členství ani oprávnění se nezměnila.

## Potvrzené závislosti

- restaurant_team_one_active_user_uidx povoluje nejvýše jedno aktivní členství na user_id. restaurant_team_one_active_email_uidx obdobně omezuje normalizovaný e-mail napříč restauracemi. Omezení UNIQUE (restaurant_id, user_id) a UNIQUE (restaurant_id, email) mají i po změně zůstat.
- current_restaurant_id() a current_restaurant_role() vybírají první aktivní členství podle id. Po pouhém odstranění globálních indexů by výběr podniku a role mohl být nesprávný.
- create_owner_restaurant(p_name) odmítá existující členství i navázaný profiles.restaurant_id. Slug odvozuje pouze z user_id, takže není vhodný pro více podniků stejného majitele. Zachovat potvrzený e-mail, ověření auth.uid(), transakční zámek a neveřejné založení.
- loadRestaurantContext() v dashboard.js načítá nejvýše dvě aktivní členství a více než jedno odmítá. Není zde výběr restaurace.
- api/invite-team-member.js určuje podnik z jediného aktivního členství majitele a blokuje aktivní e-mail v jiném podniku. Případný výběr podniku musí server ověřit proti konkrétnímu aktivnímu členství s rolí owner.
- api/send-email.js má operace s explicitním restaurant_id a kontrolou členství. Před rozšířením ověřit každou akci samostatně; vybraná hodnota v prohlížeči sama oprávnění nedokazuje.

## Pořadí implementace

1. Doplnit izolované databázové případy jednoho uživatele ve více podnicích s rozdílnými rolemi. Zmapovat všechny politiky a funkce používající implicitní první podnik; neomezit kontrolu jen na dvě pomocné funkce.
2. Navrhnout explicitní kontext restaurace. Identifikátor z klienta je nedůvěryhodný; každý privilegovaný endpoint i databázová cesta musí ověřit aktivní členství a roli pro cílový podnik.
3. Upravit zakládání s unikátním slugem pro každý podnik a ochranou proti souběhu a opakování po nejasném výsledku.
4. Upravit pozvánky a kontroly členství. Zachovat zákaz neoprávněného přidělení role owner a ochranu posledního majitele.
5. Přidat výběr a přepínání v administraci. Před změnou kontextu zneplatnit staré požadavky a vyprázdnit data, rozpracované formuláře, fronty a upozornění starého podniku. U rozepsané práce vyřešit upozornění na ztrátu změn. Zapamatování výběru vázat na účet.
6. Teprve po společném ověření připravit a provést migraci omezujících indexů a helperů. Změny klienta, API a databáze koordinovat; neprohlásit podporu za hotovou samotným přepínačem.
7. Ověřit v přihlášeném prohlížeči načtení, změnu podniku a ztrátu členství včetně skutečných databázových oprávnění.

## Přejímka

- Majitel A a obsluha B ve stejném účtu mají v každém podniku správné funkce.
- Cizí ID, podvržená role, neaktivní členství a stará relace neumožní číst ani zapisovat cizí data.
- Všechny rezervace, CRM, historie, stoly, skupiny, menu, obrázky, nastavení, tým a upozornění patří vybranému podniku.
- Pozvánka se vztahuje na zvolený podnik a neudělí širší oprávnění.
- Opakované/souběžné založení, odhlášení během operace a odebrání přístupu během přepínání mají bezpečný výsledek.
- Existující účty s jednou restaurací fungují dál.
- Do úspěšné přejímky zůstává omezení jednoho aktivního podniku zachováno.
