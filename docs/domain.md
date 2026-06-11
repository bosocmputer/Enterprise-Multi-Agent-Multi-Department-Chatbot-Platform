# Domain Model

## Platform Vocabulary

| Term | Meaning | Source of truth |
| --- | --- | --- |
| Lookup bot | Chatbot that answers staff lookup questions using a tenant-approved source system. The first production pilot is inventory stock/price. | This service |
| Tenant | A customer/business configuration boundary. | Deploy config or profile store |
| Business Profile | Tenant-specific domain profile, phrases, examples, aliases, locale, reply style, and source labels. | Config/profile store |
| Domain Profile v2 | Tenant-defined entity types, actions, examples, reply style, and connector mapping. Core runtime normalizes v1 profiles into v2 internally. | Config/profile store |
| Business domain | The type of business, such as auto parts, construction materials, pharmacy, or stationery. | Business Profile |
| Channel | Chat provider such as Telegram or LINE. | `src/channels/*` planned |
| Chat type | `private` or `group`. | Normalized channel payload |
| Group gate | Rule that group conversations require mention, reply-to-bot, command, or prefix before the bot responds. | Channel adapter |
| Entity | Domain object users can look up, such as inventory item, customer, document, or job. | Domain Profile |
| Entity candidate | Generic candidate shape: `id`, `label`, `type`, optional `description`, optional `metadata`. | Connector adapter |
| Lookup action | Tenant-approved action such as search, availability, price, balance, or status. | Domain Profile |
| Lookup query | User-supplied search text such as name, code, model, alias, or other tenant-defined descriptor. | Query understanding layer |
| Alias/index entry | Tenant-specific nickname, brand variant, abbreviation, or catalog-derived search expansion. | Business Profile or catalog index |
| Legacy inventory intent | Backward-compatible inventory intent such as `search_product`, `stock`, `price`, or `stock_price`. | Query understanding layer |
| Last entity context | Short-lived session memory used for follow-up questions and numeric disambiguation. | Redis session service |
| SML MCP client | Integration wrapper around SML HTTP `/call`. | `src/integrations/smlClient.ts` planned |
| Connector allowlist | Explicit read-only tool/API names the bot can call for a tenant action. | Domain Profile and connector adapter |
| Freshness | Age or cache status of the source data used in a reply. | Cache service |

## Business Rules

- Rule: MVP is read-only; it must not create reservations, documents, customers, or ERP mutations.
- Rule: SML is the source of truth for the current inventory pilot.
- Rule: the bot must not invent source facts when SML fails or returns invalid data.
- Rule: source code must not hardcode tenant product keywords, brand aliases, or business-specific examples.
- Rule: business-specific vocabulary belongs in Business Profile or catalog-derived alias/index data.
- Rule: group messages require group gate approval before parsing or SML calls.
- Rule: no-match replies ask for clearer code/model/descriptor instead of guessing.
- Rule: multi-match replies ask the user to choose among entity candidates.
- Rule: exact entity ID lookup can skip broad keyword search when ID format confidence is high.
- Rule: stock cache TTL must be short and business-approved.
- Rule: price cache TTL must be business-approved.
- Rule: logs must not include secrets or raw sensitive SML/customer payloads.

## User Roles

| Role | Can do in MVP | Cannot do in MVP |
| --- | --- | --- |
| Store staff | Ask approved lookup questions in allowed channels. | Create sale reservation or ERP documents. |
| Pilot tester | Test Telegram private/group flows and report search quality. | Change production channel secrets or SML config. |
| Admin/Ops | Configure bot tokens, webhook URLs, SML base URL, cache TTLs, and allowlists. | Store real secrets in tracked files. |
| Developer | Implement parser, adapters, SML client, tests, and observability. | Bypass read-only allowlist or log raw secrets. |

## Integrations

| Integration | Purpose | Credentials location | Failure behavior |
| --- | --- | --- | --- |
| Telegram Bot API | Pilot channel for private/group stock-price lookup. | Local/deploy secret source | Verify webhook secret; retry bounded reply failures; expose channel metrics. |
| LINE Messaging API | Production staff channel after Telegram flow is stable. | Local/deploy secret source | Verify raw-body signature; handle group mention; retry bounded reply failures. |
| SML MCP HTTP `/call` | Read inventory item, stock, and price for the first connector. | SML base URL and role config in env/secrets | Timeout fast, validate schema, fail closed, circuit-break repeated failures. |
| Redis | Cache, dedup, rate limit, and short session context. | Local/deploy secret source | Continue direct lookup if safe; disable context/cache features; alert. |
| Business Profile store | Tenant-specific parser/config data. | Config file, database, or profile service | Disable affected tenant or fall back to generic clarification if profile is invalid. |
| Optional LLM provider | Parse ambiguous messages into structured action/entity/query JSON only. | Local/deploy secret source | Skip and ask clarification on outage or low confidence. |

## Lookup Actions

Domain Profile v2 defines actions first. Legacy inventory intents are compatibility metadata for the current SML adapter.

| Action | Legacy inventory intent | Required data | Current SML tool mapping |
| --- | --- | --- | --- |
| `search` | `search_product` | entity query | `search_product` |
| `availability` | `stock` | entity ID or query | `search_product`, `get_stock_balance` |
| `price` | `price` | entity ID or query | `search_product`, `get_product_price` |
| `availability_price` | `stock_price` | entity ID or query | `search_product`, `get_stock_balance`, `get_product_price` |

## Business Profile Requirements

Every production tenant should define:

- Domain Profile v2 entities and actions
- connector mapping from actions to read-only tools/APIs
- enabled legacy intents for the current inventory adapter, until fully removed
- user-facing help examples
- locale and normalization rules
- phrase sets for tenant actions
- optional alias entries or a link to a catalog-derived alias/index
- source dataset label and tenant status: `demo` or `real`
- reply style for no-match, multi-match, and fallback states

The runtime can normalize old v1 profiles into v2 for compatibility, but new production tenants should supply v2 explicitly. Customer-specific product names, brands, examples, and aliases must be supplied as data.

## Future Scope

Possible future additions, not MVP:

- sale reservation creation after approval and sandbox testing
- customer lookup
- supplier/purchase lookup
- admin policy UI
- local product alias index
- mock and real tenant profile fixtures for each supported domain before cutover
- Business Profile admin UI and validation workflow
- document/manual lookup
- multi-branch stock routing
