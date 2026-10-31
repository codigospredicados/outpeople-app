# OurPeople App

Repositório independente da PWA móvel OurPeople. Inclui a interface pública, registo/conta, mapa OpenStreetMap e avisos de ruas com possíveis nomes de pessoas.

## Executar

Node.js 22.13 ou superior e npm:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Abra <http://localhost:3001/> (redireciona para `/app/`). Registo e conta: `/app/#conta`. Para execução normal: `npm start`. Testes deste repositório: `npm test`.

A interface está em `public/`. O servidor só publica essa pasta e os ficheiros Leaflet da sua própria dependência npm. Não lê ficheiros dos repositórios API ou backoffice.

## Variáveis

| Variável | Exemplo | Função |
| --- | --- | --- |
| `PORT` | `3001` | Porta local; em implantação respeita o valor do ambiente. |
| `API_URL` | `http://localhost:3000` | Origem da API, sem `/api` no fim. Obrigatória em produção. |
| `NODE_ENV` | `development` | Usar `production` no Railway. |
| `TRUST_PROXY_HOPS` | `0` | Proxies confiáveis à frente deste servidor; ajustar no Railway. |

Todos os pedidos `/api/*` são encaminhados pelo servidor para `API_URL`, preservando cookies, corpo, estado e redirecionamentos. O navegador comunica apenas com a origem da app. A API deve ter `APP_URL` configurado para a origem pública desta app. Não colocar segredos Google/Facebook neste repositório nem no JavaScript público.

## Funcionalidades

- Mapa público Leaflet/OpenStreetMap, com zoom, navegação e vista inicial de Portugal continental.
- Registo, início/fim de sessão e consulta da conta; métodos sociais disponíveis segundo a configuração da API.
- Localização opcional, com ponto e círculo de precisão.
- «Ativar alertas de ruas» acompanha a deslocação enquanto o mapa está visível e mostra um aviso quando o nome do arruamento sugere uma pessoa.
- Avisos podem ser fechados; não são repetidos no mesmo arruamento. Novas ruas permitem novos avisos.
- Acompanhamento pausa ao ocultar o mapa/página; não utiliza localização em segundo plano nem notificações do sistema.

As posições são enviadas à API para identificar o arruamento. A classificação é indicativa, com associação por confirmar. Cruzamentos ambíguos e precisão insuficiente não originam alertas. Oscilações inferiores a 15 m não geram nova consulta; pedidos ficam separados por pelo menos 15 segundos. Geolocalização requer HTTPS ou localhost.

A API é um serviço separado: precisa de estar disponível para registo, autenticação e identificação de ruas. A publicação de conteúdos e a confirmação da identidade das personalidades ainda não estão implementadas.

## PWA e cartografia

O manifesto, ícones e service worker permitem abrir a interface sem rede depois da primeira visita com ligação. API e cartografia requerem rede. A cache da PWA inclui apenas ficheiros estáticos; não guarda respostas da API, dados da conta nem mosaicos OSM.

Leaflet é servido localmente. Os mosaicos são pedidos à área visível em `https://tile.openstreetmap.org`, com atribuição visível e cache HTTP normal. Não há descarga antecipada de regiões nem modo de mapas offline. Para utilização de maior volume selecione um serviço de cartografia adequado; consulte a [política de mosaicos OSM](https://operations.osmfoundation.org/policies/tiles/) e a [documentação Leaflet](https://leafletjs.com/examples/quick-start/).

Os ícones PNG estão incluídos. Em Windows, pode regenerá-los com `./scripts/generate-icons.ps1`.

## Railway

1. Ligue o seu repositório Git deste componente a um serviço Railway, com raiz `/`.
2. O [Dockerfile é detetado automaticamente](https://docs.railway.com/builds/dockerfiles) e inicia o servidor com Node. Não é necessário compilar a interface.
3. Configure `NODE_ENV=production` e `API_URL=https://API-DOMAIN`. Na mesma rede privada Railway pode usar `http://API-INTERNAL-HOST:API-PORT`; em projetos diferentes use a origem pública HTTPS.
4. Gere o domínio HTTPS da app e, no serviço API, configure `APP_URL=https://APP-DOMAIN`.
5. Configure o healthcheck em `/health` e os proxies confiáveis da topologia. O servidor escuta em `0.0.0.0:$PORT` (imagem: 8080 por omissão).
6. Para Google/Facebook, registe os callbacks `https://APP-DOMAIN/api/auth/google/callback` e `https://APP-DOMAIN/api/auth/facebook/callback` nos fornecedores.

Este serviço não precisa de volume nem de base de dados. Não depende dos ficheiros ou do ciclo de deploy dos restantes repositórios. Em domínios diferentes, app e backoffice têm sessões próprias.

O workflow de CI instala dependências com `npm ci` e verifica ficheiros públicos e proxy HTTP, incluindo cookies, origens, redirecionamentos e falhas da API.
