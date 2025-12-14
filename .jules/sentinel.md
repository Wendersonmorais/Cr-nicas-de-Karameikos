## 2024-05-23 - Client-Side API Key Exposure Pattern
**Vulnerability:** Google Gen AI API key is injected via Vite's `define` into the client bundle.
**Learning:** In serverless/static frontend architectures (like this Vite SPA), secrets are often exposed because there is no backend to hold them. This allows anyone with the bundle to extract the key.
**Prevention:** Use a Backend-for-Frontend (BFF) or API Proxy to hold the key and forward requests. If client-side only is required, restrict the API key by HTTP Referrer in the Google Cloud Console.
