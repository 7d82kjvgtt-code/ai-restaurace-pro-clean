# Dashboard language support

The dashboard now offers a persisted Czech/English selector on the login screen and in the dashboard header. Czech remains the default, including when browser storage cannot be read. Changing language requires confirmation and reloads the current page, preserving the current section; cancelling or failing to save the preference leaves the current language and forms untouched.

`dashboard-i18n.js` initializes synchronously before `restaurant-context.js` and `dashboard.js`. Only explicitly marked source HTML text nodes and presentation attributes are translated. Nested form controls and event handlers are retained. There is no document-wide mutation observer. User-provided restaurant names, dishes, guest data and input values are never passed through automatic translation. Option values, status identifiers, role identifiers, hashes and request payloads remain unchanged.

Included coverage:

- Source HTML labels, descriptions, table headers, menu navigation, placeholders and accessible labels across dashboard sections.
- Login, registration, password recovery, first restaurant creation and additional restaurant creation/selection messages.
- Per-restaurant role labels, setup checklist summary and publication hints.
- Existing AI messages follow the selected language; AI remains disabled.
- Locale-sensitive number/date displays use the chosen locale, retaining the existing restaurant time-zone settings. Plain numeric dates and native browser date/validation controls retain their existing formatting behaviour.

Still incomplete: dynamically generated operational lists, some modal and validation messages, notification text, chart labels, CSV headers, team invitation API messages and invitation acceptance pages. This commit is the language foundation and first translated flows, not complete English acceptance for the entire application.

Validation: syntax checks and the full offline regression suite pass. The language test parses the actual dashboard HTML and executes the actual translation script and login handlers. It verifies unchanged form option values, DOM identities, validation attributes and event handlers; safe text rendering of restaurant names; English per-restaurant role labels; fallback with invalid/blocked storage; cancelled language switches; and local sign-in/account validation without any external requests.

Authenticated browser acceptance across both languages, unsaved forms and two real restaurant memberships remains pending. No new production users, reservations or emails are created by the tests.
