# Domain Model

## Platform Vocabulary

| Term | Meaning | Source of truth |
| --- | --- | --- |
| Inventory lookup bot | Chatbot that answers stock and price questions for staff across business domains. | This service |
| Tenant | A customer/business configuration boundary. | Deploy config or profile store |
| Business Profile | Tenant-specific intents, phrases, examples, aliases, locale, reply style, and SML dataset labels. | Config/profile store |
| Business domain | The type of business, such as auto parts, construction materials, pharmacy, or stationery. | Business Profile |
| Channel | Chat provider such as Telegram or LINE. | `src/channels/*` planned |
| Chat type | `private` or `group`. | Normalized channel payload |
| Group gate | Rule that group conversations require mention, reply-to-bot, command, or prefix before the bot responds. | Channel adapter |
| Product keyword | User-supplied search text such as product name, model, brand, or alias. | Query understanding layer |
| Alias/index entry | Tenant-specific nickname, brand variant, abbreviation, or catalog-derived search expansion. | Business Profile or catalog index |
| Product code | Stable SML item/product code. | SML |
| Product candidate | A product returned by SML `search_product`. | SML response |
| Lookup intent | Structured intent such as `search_product`, `stock`, `price`, or `stock_price`. | Query understanding layer |
| Last product context | Short-lived session memory used for follow-up questions. | Redis session service |
| SML MCP client | Integration wrapper around SML HTTP `/call`. | `src/integrations/smlClient.ts` planned |
| Read-only allowlist | Explicit SML tool names the bot can call. | SML client config |
| Freshness | Age or cache status of the stock/price data used in a reply. | Cache service |

## Business Rules

- Rule: MVP is read-only; it must not create reservations, documents, customers, or ERP mutations.
- Rule: SML is the source of truth for product, stock, and price.
- Rule: the bot must not invent stock or price when SML fails or returns invalid data.
- Rule: source code must not hardcode tenant product keywords, brand aliases, or business-specific examples.
- Rule: business-specific vocabulary belongs in Business Profile or catalog-derived alias/index data.
- Rule: group messages require group gate approval before parsing or SML calls.
- Rule: no-match replies ask for clearer product code/model/brand instead of guessing.
- Rule: multi-match replies ask the user to choose among product candidates.
- Rule: exact product code lookup can skip broad keyword search when code format confidence is high.
- Rule: stock cache TTL must be short and business-approved.
- Rule: price cache TTL must be business-approved.
- Rule: logs must not include secrets or raw sensitive SML/customer payloads.

## User Roles

| Role | Can do in MVP | Cannot do in MVP |
| --- | --- | --- |
| Store staff | Ask stock and price questions in allowed channels. | Create sale reservation or ERP documents. |
| Pilot tester | Test Telegram private/group flows and report search quality. | Change production channel secrets or SML config. |
| Admin/Ops | Configure bot tokens, webhook URLs, SML base URL, cache TTLs, and allowlists. | Store real secrets in tracked files. |
| Developer | Implement parser, adapters, SML client, tests, and observability. | Bypass read-only allowlist or log raw secrets. |

## Integrations

| Integration | Purpose | Credentials location | Failure behavior |
| --- | --- | --- | --- |
| Telegram Bot API | Pilot channel for private/group stock-price lookup. | Local/deploy secret source | Verify webhook secret; retry bounded reply failures; expose channel metrics. |
| LINE Messaging API | Production staff channel after Telegram flow is stable. | Local/deploy secret source | Verify raw-body signature; handle group mention; retry bounded reply failures. |
| SML MCP HTTP `/call` | Read product, stock, and price. | SML base URL and role config in env/secrets | Timeout fast, validate schema, fail closed, circuit-break repeated failures. |
| Redis | Cache, dedup, rate limit, and short session context. | Local/deploy secret source | Continue direct lookup if safe; disable context/cache features; alert. |
| Business Profile store | Tenant-specific parser/config data. | Config file, database, or profile service | Disable affected tenant or fall back to generic clarification if profile is invalid. |
| Optional LLM provider | Parse ambiguous messages into structured queries only. | Local/deploy secret source | Skip and ask clarification on outage or low confidence. |

## Supported Intents

| Intent | Example | Required data | SML tools |
| --- | --- | --- | --- |
| `search_product` | tenant-specific search phrase | keyword | `search_product` |
| `stock` | product code or tenant-specific stock phrase | product code or keyword | `search_product`, `get_stock_balance` |
| `price` | product code or tenant-specific price phrase | product code or keyword | `search_product`, `get_product_price` |
| `stock_price` | tenant-specific stock+price phrase | product code or keyword | `search_product`, `get_stock_balance`, `get_product_price` |

## Business Profile Requirements

Every production tenant should define:

- enabled intents and user-facing help examples
- locale and normalization rules
- intent phrase sets for stock, price, and search
- optional alias entries or a link to a catalog-derived alias/index
- SML dataset label and tenant status: `demo` or `real`
- reply style for no-match, multi-match, and fallback states

The default profile may support generic Thai stock/price phrases for demos, but customer-specific product names and brands must be supplied as data.

## Future Scope

Possible future additions, not MVP:

- sale reservation creation after approval and sandbox testing
- customer lookup
- supplier/purchase lookup
- admin policy UI
- local product alias index
- Business Profile admin UI and validation workflow
- document/manual lookup
- multi-branch stock routing
