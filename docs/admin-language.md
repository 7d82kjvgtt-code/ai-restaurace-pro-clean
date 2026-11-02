# Dashboard language support

Updated 2 November 2026. The dashboard offers a persisted Czech/English selector on the login screen and in the dashboard header. Czech remains the default, including when browser storage cannot be read. Changing language requires confirmation and reloads the current page, preserving the current section; cancelling or failing to save the preference leaves the current language and forms untouched.

`dashboard-i18n.js` initializes synchronously before `restaurant-context.js` and `dashboard.js`. Only explicitly marked source HTML text nodes and presentation attributes are translated. Nested form controls and event handlers are retained. There is no document-wide mutation observer. User-provided restaurant names, dishes, guest data and input values are never passed through automatic translation. Option values, status identifiers, role identifiers, hashes and request payloads remain unchanged.

Included coverage:

- Static labels, accessible labels, descriptions, placeholders and navigation across dashboard sections.
- Authentication, first restaurant creation and additional restaurant selection/creation.
- Dynamically rendered reservations, notifications, upcoming arrivals, history, CRM, team controls, opening hours, blocked times, tables, floor-map messages, menu and validation messages.
- Chart labels and CSV presentation headers/status labels. The canonical status strings used by filters, database requests, CSS classes and event handlers remain unchanged.
- Fixed application menu category labels; unknown/custom category strings and all user-provided names/descriptions stay untouched.
- Invitation API responses in the caller's selected locale. Locale does not influence any authorization or target restaurant checks.
- Invitation acceptance page with an in-place CZ/EN switch. It does not reload or discard the one-use authentication session/password input. Existing invitation session handling is retained.
- Application-owned API errors, including numeric/time placeholders. Unrecognized upstream diagnostic messages retain their original text.
- Existing AI copy uses the selected language. AI remains disabled.

`dashboardMessage` translates source template fragments before inserting values. It never translates the values themselves. Translation tests compare placeholder multisets and executable HTML attributes to prevent accidental identifier changes, missing data or interpolation changes. Language changes in the dashboard still confirm/reload to discard unsaved form changes explicitly; the invitation page uses cached original source nodes and refreshes only presentation.

Validation: syntax checks and the full offline regression suite pass. In addition to static HTML/value checks, the tests execute the actual reservation, team, CRM and opening-hour renderers in Czech and English; verify safe rendering of malicious-looking guest/team names; preserve canonical status values and event-handler arguments; verify application API error placeholders; and switch the actual invitation page both ways without reloading or discarding input. Invitation boundary cases run in both languages; no real messages are sent.

Authenticated browser acceptance across both languages, unsaved forms and two real restaurant memberships remains pending. No new production users, reservations or emails are created by the tests.
