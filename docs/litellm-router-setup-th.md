# คู่มือตั้งค่า LiteLLM Auto Router สำหรับ Chatbot

เอกสารนี้อธิบายวิธีตั้งค่า LiteLLM ให้ chatbot ใช้ LLM parser แบบปลอดภัย โดยให้ LiteLLM เป็นคนเลือก provider/model ที่เหมาะสมเองผ่าน auto router

## ภาพรวม

ระบบ chatbot ไม่ควรเรียก model ปลายทางโดยตรง เช่น `cli-codex` หรือ `openrouter/openrouter/free` ใน production pilot แต่ควรเรียกชื่อ router กลางแทน

```text
chatbot -> LiteLLM /v1/chat/completions model=<ROUTER_NAME>
        -> LiteLLM Auto Router เลือก model/provider ข้างใน
        -> chatbot validate JSON
        -> chatbot ค้น SML
        -> reply user
```

ค่าที่ใช้อยู่ตอนนี้:

| รายการ | ค่า |
| --- | --- |
| LiteLLM URL | `http://192.168.2.248:4000` |
| Router name | เช่น `parts-lookup-parser-auto-2` |
| Router type | Complexity Router |
| Simple tier | `openrouter/openrouter/free` |
| Medium tier | `cli-codex` |
| Complex tier | `cli-codex` |
| Reasoning tier | `cli-claude` |
| Chatbot env | `LITELLM_MODEL=<ROUTER_NAME>` |

ข้อสำคัญ: OpenAI-compatible endpoint ของ LiteLLM ยังต้องมี `model` เสมอ ถ้าไม่ส่ง `model` จะได้ error ประมาณ `model=None` ดังนั้นห้ามลบ `LITELLM_MODEL`; ให้ตั้งเป็นชื่อ router แทน

## วิธีตั้งค่าใน LiteLLM UI

เข้า LiteLLM UI:

```text
http://192.168.2.248:4000/ui/?page=models
```

1. ไปที่เมนู `Models + Endpoints`
2. เปิด tab `Add Model`
3. เปิด sub-tab `Add Auto Router`
4. เลือก `Complexity Router`
5. กรอก `Auto Router Name`

```text
parts-lookup-parser-auto-2
```

6. ตั้งค่า tier ดังนี้

```text
Simple Tier    = openrouter/openrouter/free
Medium Tier    = cli-codex
Complex Tier   = cli-codex
Reasoning Tier = cli-claude
```

ความหมายของ tier:

| Tier | ใช้เมื่อ | แนวคิด |
| --- | --- | --- |
| Simple | คำถามสั้น ง่าย หรือต้องการงานเบา | ใช้ model ที่ถูก/เร็ว/เบาได้ |
| Medium | คำถามทั่วไปที่ต้องตีความระดับปกติ | ใช้ model หลักที่สมดุลความเร็วกับคุณภาพ |
| Complex | คำถามยาว หลายเงื่อนไข หรือมีรายละเอียดมากขึ้น | ใช้ model ที่เก่งกว่า/รองรับงานหนักกว่า |
| Reasoning | คำถามที่มีสัญญาณว่าต้องวิเคราะห์เป็นขั้นตอน | ใช้ model reasoning หรือ model ที่เหมาะกับงานคิดซับซ้อน |

สำหรับ chatbot นี้ tier เป็นการตั้งค่าภายใน LiteLLM Router เท่านั้น แอป chatbot ยังเรียกแค่ `<ROUTER_NAME>` ตัวเดียว ไม่ได้เลือก tier เอง

7. กด `Add Auto Router`
8. ตรวจว่ามี success message เช่น

```text
Model parts-lookup-parser-auto-2 created successfully
Successfully created Complexity Router: parts-lookup-parser-auto-2
```

หมายเหตุ: ถ้าปุ่ม `Test Connection` ในหน้า Auto Router ขึ้น error แต่ `Add Auto Router` สำเร็จ ให้ยืนยันด้วย smoke test ด้านล่างแทน เพราะบางเวอร์ชันของ UI อาจ test router ไม่สมบูรณ์

## ให้ Virtual Key เรียก Router ได้

หลังสร้าง router แล้ว ต้องให้ key ที่ chatbot ใช้มีสิทธิ์เรียก router ด้วย ไม่อย่างนั้นจะเจอ error:

```text
key not allowed to access model
```

ใน UI:

1. ไปที่ `Virtual Keys`
2. เลือก key ที่ chatbot ใช้
3. แก้ `Models` หรือ model access
4. เพิ่ม `<ROUTER_NAME>` เช่น `parts-lookup-parser-auto-2`
5. Save

รายการ models ที่ key ของ chatbot ควรเห็นสำหรับ production-style pilot:

```text
parts-lookup-parser-auto-2
```

เหตุผล: key ของ chatbot ควรถูกจำกัดแบบ least privilege ให้เรียกได้เฉพาะ router model ตัวเดียว ส่วน `cli-claude`, `cli-codex`, และ `openrouter/openrouter/free` เป็น model ปลายทางภายใน LiteLLM Router ไม่จำเป็นต้อง expose ให้ chatbot key เห็น

เฉพาะกรณี debug/admin ชั่วคราว อาจให้ key เห็น model ปลายทางโดยตรงได้ แต่ไม่ใช่ค่าแนะนำสำหรับ pilot/production

ถ้าต้องทำผ่าน API ให้ใช้ admin key ผ่าน `/key/update` โดยใส่ key จริงในเครื่อง/server เท่านั้น ห้าม commit หรือใส่ใน docs

```bash
curl -sS -X POST 'http://192.168.2.248:4000/key/update' \
  -H 'Authorization: Bearer <LITELLM_ADMIN_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "<CHATBOT_LITELLM_KEY>",
    "models": [
      "<ROUTER_NAME>"
    ]
  }'
```

## ตั้งค่า Chatbot Server

ใน server `.env` ของ chatbot:

```text
LLM_PARSER_ENABLED=true
LLM_PARSER_MODE=assist
LLM_PROVIDER=litellm
LITELLM_BASE_URL=http://192.168.2.248:4000
LITELLM_API_KEY=<CHATBOT_LITELLM_KEY>
LITELLM_MODEL=<ROUTER_NAME>
LLM_PARSER_TIMEOUT_MS=30000
LLM_MIN_CONFIDENCE=0.75
LLM_MAX_CONCURRENT_CALLS=2
LLM_ASSIST_QUEUE_WAIT_MS=5000
ASSIST_USER_STATUS_ENABLED=true
ASSIST_USER_STATUS_SHOW_MODEL=true
ASSIST_STATUS_MIN_DELAY_MS=800
ASSIST_RESULT_FOOTER_ENABLED=true
```

Restart เฉพาะ app container:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
docker compose up -d --force-recreate parts-lookup-api
```

## Smoke Test LiteLLM โดยตรง

ทดสอบว่า key เห็น router:

```bash
curl -sS 'http://192.168.2.248:4000/v1/models' \
  -H 'x-litellm-api-key: <CHATBOT_LITELLM_KEY>'
```

ต้องเห็น `<ROUTER_NAME>` อยู่ในรายการ และโดยค่าแนะนำสำหรับ chatbot key ควรเห็นแค่ router ตัวนี้ตัวเดียว

ทดสอบเรียก router:

```bash
curl -sS 'http://192.168.2.248:4000/v1/chat/completions' \
  -H 'x-litellm-api-key: <CHATBOT_LITELLM_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "<ROUTER_NAME>",
    "messages": [
      {"role": "system", "content": "Return JSON only with fields intent, query, confidence."},
      {"role": "user", "content": "มีปูนตราช้างเหลือไหม"}
    ],
    "temperature": 0,
    "max_tokens": 80,
    "response_format": {"type": "json_object"}
  }'
```

ผลที่ต้องการ:

- HTTP `200`
- มี `choices[0].message.content`
- content เป็น JSON
- `model` ใน response เป็น `<ROUTER_NAME>` หรือ route ที่ LiteLLM คืนมา

## Smoke Test ผ่าน Chatbot

บน server:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
set -a
. ./.env
set +a

curl -sS -X POST 'http://127.0.0.1:3060/internal/parse' \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"มีปูนตราช้างเหลือไหม"}'
```

ผลที่ต้องการ:

- `status` หรือ `outcome` เป็น `parsed`
- `parserPath` หรือ metadata ระบุ `llm_assist`
- `model` เป็น `<ROUTER_NAME>`

ทดสอบ lookup:

```bash
curl -sS -X POST 'http://127.0.0.1:3060/internal/lookup' \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"มีปูนตราช้างเหลือไหม"}'
```

ผลที่ต้องการ:

- ถ้า SML เจอหลายรายการ ให้ตอบ multi-match
- final reply มี footer ว่า LiteLLM ช่วยตีความ แต่ stock/price มาจากระบบต้นทาง
- ถ้า LLM fail ต้อง fallback อย่างปลอดภัย ไม่แต่ง stock/price เอง

เช็ก fast path ว่ายังไม่เรียก LLM:

```bash
curl -sS -X POST 'http://127.0.0.1:3060/internal/lookup' \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"PAINT-01424 ราคา"}'
```

ผลที่ต้องการ:

- `parserPath=deterministic`
- latency เร็วกว่ากลุ่ม LLM assist ชัดเจน
- ไม่มี assist footer

## ดู Logs และ Metrics

Logs:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
docker compose logs --tail=100 parts-lookup-api
```

ฟิลด์ที่ควรเห็นเมื่อเข้า LLM assist:

```text
msg="llm parser completed"
mode="assist"
model="<ROUTER_NAME>"
outcome="parsed" หรือ rejected_*
durationMs=<latency>
textHash=<hash>
```

Metrics ที่เกี่ยวข้อง:

```text
parts_lookup_llm_parse_total{mode,outcome,model}
parts_lookup_llm_parse_duration_ms{model,outcome}
parts_lookup_llm_assist_started_total{mode,model,reason}
```

ห้าม log raw API key, raw token, chat id, user id, หรือ prompt payload ใหญ่

## Rollback

ถ้า LiteLLM ช้า/ล่ม/ตอบ JSON ไม่เสถียร ให้ rollback ด้วย config ไม่ต้องแก้ code:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
perl -0pi -e 's/^LLM_PARSER_MODE=.*/LLM_PARSER_MODE=shadow/m' .env
docker compose up -d --force-recreate parts-lookup-api
```

หรือปิด LLM parser ทั้งหมด:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
perl -0pi -e 's/^LLM_PARSER_ENABLED=.*/LLM_PARSER_ENABLED=false/m; s/^LLM_PARSER_MODE=.*/LLM_PARSER_MODE=off/m' .env
docker compose up -d --force-recreate parts-lookup-api
```

## Troubleshooting

### `model=None`

สาเหตุ: request ไม่ได้ส่ง `model`

วิธีแก้: ตั้ง `LITELLM_MODEL=<ROUTER_NAME>` ใน chatbot `.env`

### `key not allowed to access model`

สาเหตุ: virtual key ยังไม่ได้ allow `<ROUTER_NAME>`

วิธีแก้: เพิ่ม router name เข้า allowed models ของ key

### LLM ตอบ JSON ไม่ตรง schema

พฤติกรรมที่ถูกต้อง: chatbot reject แล้ว fallback ปลอดภัย

สิ่งที่ต้องดู:

- `parts_lookup_llm_parse_total{outcome="rejected_*"}`
- logs `llm parser completed`
- prompt/schema contract ใน code

### LLM ช้ามาก

พฤติกรรมที่ถูกต้อง:

- Telegram ส่ง status message ว่ากำลังใช้ LiteLLM assist model
- ระบบจำกัด concurrency ด้วย `LLM_MAX_CONCURRENT_CALLS`
- ถ้า queue เต็ม ต้อง fallback ไม่ทำให้ polling backlog พัง

ทางเลือก:

- เปลี่ยน tier ใน LiteLLM router
- ลด `LLM_PARSER_TIMEOUT_MS`
- ลด `LLM_MAX_CONCURRENT_CALLS`
- rollback เป็น `shadow` หรือ `off`

## Production Notes

- LiteLLM ใช้ตีความคำถามเท่านั้น ไม่ตอบราคา/สต็อกเอง
- SML MCP ยังเป็น source of truth สำหรับ stock/price
- Fast path เช่นรหัสสินค้าชัดเจนต้องไม่เรียก LLM
- ห้าม hardcode brand/product/domain vocabulary ใน source code
- Tenant-specific examples/aliases ต้องอยู่ใน Business Profile หรือ catalog-derived index
- Key และ admin password ต้องอยู่ใน secret store หรือ server `.env` เท่านั้น
