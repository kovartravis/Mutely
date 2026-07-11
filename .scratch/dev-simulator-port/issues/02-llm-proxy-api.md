Type: task
Status: resolved
Blocked by: (none)

## Question

How do we implement a secure Next.js API route that proxies prompts to a customizable LLM endpoint, handling customizable authorization headers, target URLs, and JSON request bodies?

## Answer

We have implemented a secure Next.js Route Handler at [src/app/api/proxy/route.ts](file:///root/Mutely/game/src/app/api/proxy/route.ts) that acts as an LLM proxy.

### Security & Connectivity Highlights
- **SSRF Protection**: Resolves the target hostname via `dns.lookup` to filter out loopback/localhost (`127.0.0.1`, `localhost`, `::1`) and cloud metadata services (`169.254.169.254`).
- **Wi-Fi / Private Network Support**: Explicitly allows requests targeting private Wi-Fi subnets (e.g., `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`, and IPv6 local address ranges `fc00::/7` / `fd00::/7`).
- **Flexible Protocol Enforcement**: Enforces `HTTPS` for all public internet endpoints while allowing `HTTP` connections for private local network IPs (allowing the proxy to integrate with local services like Ollama or LM Studio running on other Wi-Fi devices).
- **Header Whitelisting**: Only forwards specific headers safe for LLM API integrations (`authorization`, `api-key`, `x-api-key`, `http-referer`, `x-title`, `accept`), sanitizing client-side request data and preventing accidental forwarding of credentials or server cookies.
- **Streaming Support**: Forwards the exact content type from the target response, permitting seamless standard/streaming setups (e.g., `text/event-stream`).

### Route Interface
- **Endpoint**: `POST /api/proxy`
- **Request Body**:
  ```json
  {
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "headers": {
      "Authorization": "Bearer <API_KEY>"
    },
    "body": {
      "model": "gpt-4o-mini",
      "messages": [...]
    }
  }
  ```

