# ChatGPT + MCP FET (bridge Streamable HTTP)

Guida pratica per collegare **ChatGPT** al server MCP FET sul PC host.  
Progetto: `C:\path\to\MCPFETIntegration` (v0.7, `fet_advise`).

> **Vincolo duro:** ChatGPT (web/Desktop plugin) **non** accetta `http://127.0.0.1` / `localhost` come URL MCP. L’errore italiano tipico è:
>
> **«Alcune impostazioni dell'app sono state rifiutate. Controlla l'URL del server o l'ID tunnel…»**
>
> Causa: ChatGPT chiama il server MCP **dai server OpenAI**, non dal tuo PC. Un URL loopback punta alle macchine OpenAI, non al PC host. Serve **Secure MCP Tunnel** (ID tunnel) oppure un URL **HTTPS** pubblico (tunnel opt-in).

Config: `config/mcp.chatgpt.example.json`, `config/mcp.chatgpt.http.example.json`, `config/chatgpt-custom-gpt.instructions.md`.

## Avvio bridge (sul PC)

```powershell
cd "C:\path\to\MCPFETIntegration"
npm run build
$env:FET_CL_PATH = "C:\path\to\MCPFETIntegration\vendor\bin\fet-7.12.0\fet-cl.exe"
# consigliato anche in loopback; OBBLIGATORIO se usi MCP_HTTP_ALLOWED_HOSTS:
$env:MCP_HTTP_TOKEN = "scegli-un-segreto-lungo"
npm run mcp:http
```

| Cosa | Valore default |
|------|----------------|
| Bind | `127.0.0.1:3847` (solo loopback) |
| Health | `http://127.0.0.1:3847/health` |
| Endpoint MCP locale | `http://127.0.0.1:3847/mcp` (**non** incollare questo in ChatGPT come URL) |
| Auth | `Authorization: Bearer <MCP_HTTP_TOKEN>` (obbligatorio se `MCP_HTTP_ALLOWED_HOSTS`) |

Smoke automatico: `npm run smoke:http`.

---

## Errore «impostazioni rifiutate» — cosa fare subito

Nella UI italiana (**Aggiungi un server MCP personalizzato** / Plugin):

| Campo UI | NON usare | Usare invece |
|----------|-----------|--------------|
| **Nome** | — | `Orario Fet` |
| **Connessione → URL del server** | `http://127.0.0.1:3847/mcp` | solo `https://…/mcp` (Opzione B) |
| **Connessione → Tunnel** | (vuoto / URL locale) | seleziona **Tunnel** e incolla il **`tunnel_id`** (Opzione A, preferita) |
| **Autenticazione** | — | **Nessuna autenticazione** (tipico) oppure OAuth se lo configuri |

Screenshot-matching (passi):

1. Apri **Plugin** → **+** → **Aggiungi un server MCP personalizzato**.
2. Nome: `Orario Fet`.
3. In **Connessione**:
   - **Preferito:** scegli **Tunnel** (non “URL”). Incolla il `tunnel_id` da [Platform → Tunnels](https://platform.openai.com/) (formato `tunnel_…`).
   - **Alternativa:** lascia modalità URL e incolla `https://<hostname-tunnel>/mcp` (mai `http://127.0.0.1…`).
4. Autenticazione: **Nessuna autenticazione** (per la prova breve).
5. Spunta **Ho compreso e desidero continuare** → **Crea come plugin**.

Se riprovi con `http://127.0.0.1:3847/mcp` l’errore di rifiuto **torna**: è il comportamento atteso.

---

## Opzione A — OpenAI Secure MCP Tunnel (preferita)

Riferimenti: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), help IT [Connettere server MCP personalizzati](https://help.openai.com/it-it/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

### Campi UI esatti

| Dove | Campo | Valore |
|------|-------|--------|
| ChatGPT Plugin | Nome | `Orario Fet` |
| ChatGPT Plugin | **Connessione** | **Tunnel** (non URL) |
| ChatGPT Plugin | **ID tunnel** | `tunnel_<hex>` creato in Platform |
| ChatGPT Plugin | Autenticazione | Nessuna (il Bearer resta sul PC via `tunnel-client`) |
| Platform | Tunnel settings | crea tunnel, associa workspace ChatGPT |
| PC | `tunnel-client` | punta a `http://127.0.0.1:3847/mcp` |

### Sul PC

1. Avvia il bridge loopback (`npm run mcp:http`) con `MCP_HTTP_TOKEN` impostato.
2. Crea/ottieni un **`tunnel_id`** in Platform tunnel settings (serve account/organizzazione Platform + permesso Tunnels).
3. Installa [`tunnel-client`](https://github.com/openai/tunnel-client) (download dal link in Platform o release GitHub).
4. Esempio HTTP verso il bridge locale:

```powershell
$env:CONTROL_PLANE_API_KEY = "<runtime-key-platform>"   # inseriscilo tu, non in chat
tunnel-client init `
  --profile fet-local `
  --tunnel-id tunnel_INCOLLA_IL_TUO_ID `
  --mcp-server-url "http://127.0.0.1:3847/mcp"
# Bearer verso il bridge (consigliato):
# aggiungi in profilo YAML mcp.extra_headers Authorization: Bearer <MCP_HTTP_TOKEN>
# oppure flag --mcp.extra-headers "Authorization: Bearer <MCP_HTTP_TOKEN>"
tunnel-client doctor --profile fet-local --explain
tunnel-client run --profile fet-local
```

5. In ChatGPT: **Connessione → Tunnel** → seleziona il tunnel o **incolla lo stesso `tunnel_id`**.
6. Tieni `tunnel-client run` attivo mentre crei il plugin e durante le chat.

**Valore da incollare in ChatGPT (Opzione A):** il tuo `tunnel_id` (es. `tunnel_0123…`), **non** un URL.

> L’agente non può creare il `tunnel_id` al posto tuo: serve il login Platform del proprietario dell’account.

---

## Opzione B — Tunnel HTTPS pubblico opt-in (`cloudflared` / `ngrok`)

**Solo se** Secure MCP Tunnel non è disponibile sul piano/UI. Espone i tool FET a Internet.

```text
ATTENZIONE SICUREZZA
- Chiunque abbia l’URL HTTPS può raggiungere /mcp.
- MCP_HTTP_TOKEN è OBBLIGATORIO insieme a MCP_HTTP_ALLOWED_HOSTS.
- La UI ChatGPT “Nessuna autenticazione” non invia Bearer: il bridge consente
  richieste senza Bearer SOLO se Host ∈ MCP_HTTP_ALLOWED_HOSTS (prova breve).
- Spegnere tunnel e bridge appena finisci. Non pubblicare l’URL.
```

### Helper scriptato

```powershell
cd "C:\path\to\MCPFETIntegration"
# 1) Avvia tunnel (stampa URL HTTPS da incollare + env per il bridge)
.\scripts\start-mcp-http-tunnel.ps1 -IUnderstandPublicExposure
# oppure: npm run mcp:http:tunnel -- -IUnderstandPublicExposure

# 2) In un ALTRO terminale, riavvia il bridge con gli env stampati dallo script:
# $env:MCP_HTTP_TOKEN = "…"
# $env:MCP_HTTP_ALLOWED_HOSTS = "xxxx.trycloudflare.com"
# $env:FET_CL_PATH = "…\fet-cl.exe"
# npm run mcp:http
```

Provider: `-Provider cloudflared` (default) oppure `-Provider ngrok`.

**Valore da incollare in ChatGPT (Opzione B):** `https://<hostname>/mcp` (stampato dallo script in verde).

Non committare URL tunnel, hostname `*.trycloudflare.com`, né valori di `MCP_HTTP_TOKEN`. Sono segreti di sessione: spegni tunnel e bridge a fine prova.

---

## Checklist italiana

1. **Sul PC:** `npm run build` → `FET_CL_PATH` → `npm run mcp:http` → apri `http://127.0.0.1:3847/health` (`ok: true`).
2. **Scegli canale:** Opzione A (Tunnel + `tunnel_id`) **preferita**, altrimenti Opzione B (`https://…/mcp`).
3. Plugin → **Aggiungi un server MCP personalizzato** → nome `Orario Fet`.
4. **Non** incollare `http://127.0.0.1:3847/mcp` nel campo URL.
5. Instructions Custom GPT: `config/chatgpt-custom-gpt.instructions.md`.
6. **Prima frase di test** (solo esempi sintetici — **mai** orari reali dell’istituto):

```text
Usa i tool FET: chiama fet_status e dimmi versione server e se fet-cl è disponibile. Poi, se ok, apri examples/sample-school.fet e proponi un fet_advise senza applicare nulla. Non aprire orari reali dell’istituto.
```

## Workflow tool (riassunto)

`fet_nl_extract` / `fet_nl_build` / `fet_nl_patch` → **`fet_advise`** → conferma → **`fet_advise_apply`** → `fet_generate` → se fallisce `fet_diagnose`.

## Checklist packaging

- [x] `npm run build` → `build/index.js` + `build/httpBridge.js`
- [x] `npm run mcp:http` (Streamable HTTP su `127.0.0.1`)
- [x] Token Bearer obbligatorio con `MCP_HTTP_ALLOWED_HOSTS`
- [x] Helper opt-in `scripts/start-mcp-http-tunnel.ps1` / `npm run mcp:http:tunnel`
- [x] Docs errore «impostazioni rifiutate» + campi URL vs Tunnel
- [x] `npm run smoke:http`
- [ ] Click-through ChatGPT: Tunnel ID **oppure** HTTPS
- [ ] Creazione `tunnel_id` Platform (account proprietario)

## Privacy

Path FET, job dirs e `.fet` restano sul PC. Non mettere segreti nel prompt del GPT. Con tunnel pubblico i dati tool possono lasciare la macchina: spegni appena finisci.

**Orari reali dell’istituto:** non sono in questo repository né nel catalogo ChatGPT. Restano solo su disco fuori dal repo. Il Custom GPT **non** deve offrire analisi di orari reali: usare `sample-school.fet` / `antonio-orario-completo` o un path che l’utente indica esplicitamente.
