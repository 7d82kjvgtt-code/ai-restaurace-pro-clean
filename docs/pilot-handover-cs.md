# Předání první restauraci — pilot

Stav k 18. 10. 2026. Tento dokument je postup předání, nikoli potvrzení, že už byl konkrétní zákazník založen a převzal systém.

## Ověřený základ

- Produkční web: https://ai-restaurace-pro-clean.vercel.app
- Ukázková restaurace: https://ai-restaurace-pro-clean.vercel.app/r/restaurace-c03b641f
- Administrace: https://ai-restaurace-pro-clean.vercel.app/dashboard.html
- Veřejná stránka má přepínač CZ / EN. Kompletní anglická administrace není součástí potvrzeného rozsahu.
- Příjem rezervace, potvrzení a zrušení byly dříve ověřeny skutečným doručením e-mailů. Tyto testy bez důvodu neopakovat.
- Oddělení dat bylo testováno na syntetických 100 restauracích; rozsah a omezení jsou v [ověření kapacity](100-restaurant-verification.md).
- AI je vypnutá. Nenabízet ji jako aktivní součást pilotu a nezapínat placené služby bez dohody.
- Neprohlašovat současný hosting za certifikovaný pro 100 vytížených podniků.

## 1. Podklady od zákazníka

Před vytvořením zákaznické restaurace získat:

- skutečný název podniku a e-mail budoucího vlastníka;
- adresu, telefon, kontaktní e-mail a odkazy, které chce podnik zveřejnit;
- otevírací dobu včetně dnů, kdy je zavřeno;
- názvy a kapacity skutečných stolů, případně terasu a neaktivní stoly;
- délku rezervace, povolený předstih, nejzazší termín a rozsah počtu hostů;
- menu, ceny, alergeny a fotografie, k jejichž použití má podnik oprávnění;
- osoby, které mají rezervace obsluhovat, a jejich potřebné role;
- potvrzení obchodního rozsahu, ceny a kontaktu pro podporu.

Hesla ani API klíče nevyžadovat zprávou. Nezveřejňovat kontakty nebo fotografie bez podkladů zákazníka.

## 2. Nastavení restaurace

- Vytvořit samostatnou restauraci a přístup vlastníka pomocí existujícího postupu aplikace. Nekopírovat identifikátor ukázkové restaurace.
- Ověřit, že přihlášený vlastník vidí správný podnik.
- Doplnit údaje podniku, skutečné stoly, otevírací dobu a pravidla rezervací.
- Nahrát zákaznické menu a fotografie; nenechávat v zákaznickém menu ukázková jídla.
- Použít veřejnou adresu /r/<slug> přidělenou této restauraci. Odkaz zkopírovat z aplikace, nesestavovat slug odhadem.
- Přidat pouze dohodnuté členy týmu s potřebnou rolí.
- Neukládat serverové klíče do prohlížeče, repozitáře ani zákaznického návodu.
- Vlastní doménu nebo další placené služby řešit až jako konkrétně dohodnutý krok.

## 3. Přejímka před spuštěním

Provést pro skutečný zákaznický podnik; nezaškrtávat jen na základě testu ukázky.

- [ ] Název, kontakty, menu a ceny odpovídají podkladům.
- [ ] Veřejná stránka je čitelná na zákazníkově telefonu i počítači.
- [ ] CZ / EN přepne veřejné texty; zákazník ví, které vlastní texty dodává v obou jazycích.
- [ ] Zavřený den a blokovaný čas nenabízí rezervaci.
- [ ] Nabízené termíny a velikosti skupin odpovídají stolům a pravidlům.
- [ ] Přihlášení vlastníka a oprávnění personálu fungují pro tento podnik.
- [ ] Po dohodě se zákazníkem jedna označená zkušební rezervace projde přijetím, potvrzením a zrušením.
- [ ] Zákazník ověří doručení souvisejících e-mailů. Zkušební záznam zůstane označený a zrušený.
- [ ] Personál umí najít novou rezervaci, přiřadit stůl, potvrdit a zrušit ji.
- [ ] Personál ví, že zpráva „rezervaci jsme přijali“ znamená čekání na potvrzení.
- [ ] Vlastník potvrdí připravenost před zveřejněním zákaznického odkazu.

Zkoušku rezervace provádět jen s domluveným příjemcem a časem. Tento dokument sám nespouští rezervaci ani rozesílku.

## 4. Předání personálu

Předat konkrétní veřejný odkaz restaurace, odkaz na administraci a kontakt podpory. Při krátkém zaškolení ukázat:

1. Přihlášení a kontrolu názvu podniku.
2. Nové rezervace a upozornění.
3. Potvrzení, změnu přiřazení stolu a zrušení rezervace.
4. Úpravu stolů, otevírací doby a blokovaných časů.
5. Úpravu menu a kontrolu veřejného webu.
6. Odhlášení na sdíleném zařízení.

Přístup do GitHubu, Vercelu nebo Supabase není běžný přístup obsluhy restaurace.

## 5. Řešení potíží

Při hlášení problému zaznamenat čas včetně časového pásma, veřejný slug, provedenou akci, hlášku a případné ID rezervace. Neposílat přístupové tokeny ani celé osobní údaje hosta.

- Nejasný výsledek odeslání: nejdřív hledat rezervaci v administraci; znovu neodesílat naslepo.
- Nedostupné termíny: prověřit datum, počet hostů, otevření, blokace a kapacitu.
- Chybějící e-mail: prověřit stav rezervace, spam a záznam o doručení; automaticky neopakovat odesílání.
- Technická chyba: ve Vercelu otevřít Logs pro daný čas a request; ověřit stav HTTP, dobu běhu a chybu.
- Problém po nasazení: nejprve zjistit chybný commit a rozsah dopadu. Návrat na staré nasazení nevrací databázové změny; migrace nevracet naslepo.
- Podezření na cizí soukromá data: nepokračovat v běžném používání dotčené funkce, uchovat minimum podkladů a před dalším spuštěním opravit a ověřit oprávnění.

## Co zatím není uzavřené

První skutečný zákazník a jeho nastavení, přejímka v jeho účtu, úplná soukromá administrace ověřená v přihlášeném prohlížeči, obnova ze zálohy prakticky vyzkoušená mimo produkci a dlouhodobá zátěž s reálnými souběžnými zápisy. Automatické vyúčtování, rozšířený MASTER a pokročilá AI nejsou tímto postupem implementované.
