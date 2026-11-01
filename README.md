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
- Camadas opcionais de distritos, concelhos e freguesias, com limites oficiais DGT/CAOP 2025 e nomes ao selecionar áreas.
- Registo, início/fim de sessão e consulta da conta; métodos sociais disponíveis segundo a configuração da API.
- Localização opcional, com ponto e círculo de precisão.
- Rua identificada com acesso à ficha e aos conteúdos públicos, mesmo sem conta.
- Seleção de uma rua por clique/toque no mapa, sem permissões de localização, com nome, indício de nome de pessoa e acesso à mesma ficha pública.
- Formulário de recolha para utilizadores autenticados: texto, fotografia pela câmara e seleção de imagens do dispositivo, com pré-visualização e remoção antes de publicar.
- «Ativar alertas de ruas» acompanha a deslocação enquanto o mapa está visível e mostra um aviso quando o nome do arruamento sugere uma pessoa.
- Avisos podem ser fechados; não são repetidos no mesmo arruamento. Novas ruas permitem novos avisos.
- Acompanhamento pausa ao ocultar o mapa/página; não utiliza localização em segundo plano nem notificações do sistema.

As posições são enviadas à API para identificar o arruamento. A classificação é indicativa, com associação por confirmar. Cruzamentos ambíguos e precisão insuficiente não originam alertas. Oscilações inferiores a 15 m não geram nova consulta; pedidos ficam separados por pelo menos 15 segundos. Geolocalização requer HTTPS ou localhost.

A API é um serviço separado: precisa de estar disponível para registo, autenticação, identificação de ruas, conteúdos e fotografias. A confirmação da identidade das personalidades fica para uma etapa futura.

O serviço externo de arruamentos pode demorar a responder. A identificação por toque e por GPS espera até 60 segundos; após oito segundos apresenta um aviso de consulta demorada. O proxy aguarda até 65 segundos de inatividade, para receber a resposta da API (40 segundos por omissão, máximo configurável de 50). As falhas de serviço são apresentadas sem as atribuir automaticamente à ligação do utilizador. Pedidos cancelados ou substituídos não atualizam o resultado atual.

### Selecionar uma rua no mapa

Aproxime o mapa e toque numa rua. Se a vista estiver afastada (abaixo do zoom 16), o primeiro toque aproxima a área e pede um novo toque sobre a rua. Um marcador castanho distingue o ponto escolhido da localização GPS. A app consulta o mesmo serviço de arruamentos e apresenta o nome, a classificação indicativa e uma ligação para os conteúdos e recolha. Não solicita geolocalização.

Cruzes de ruas e pontos sem arruamento nomeado dão resultados inconclusivos, com instruções para escolher outro ponto. Falhas de rede/serviço permitem repetir a consulta; selecionar outro ponto cancela a consulta anterior. Cliques rápidos são agregados durante 350 ms. Aplicam-se os limites existentes da API/Overpass, sem repetição automática de consultas.

Com camadas administrativas ativas, cliques em vistas amplas mostram a informação administrativa; a partir do zoom 16 selecionam a rua. A seleção é limpa ao sair do mapa, ocultar a página, repor a vista inicial ou usar «Limpar seleção no mapa». Alertas GPS mantêm o seu funcionamento independente.

## Recolha de informação

Depois de identificar a localização, «Consultar e contribuir nesta rua» abre `/app/#rua/:id`. A ficha mostra os conteúdos partilhados, com nome do autor, data e fotografias. «Partilhar informação ou fotografias» abre `/app/#rua/:id/recolher`. A API guarda estes dados no MongoDB para os próximos visitantes da rua.

Sem sessão, o formulário encaminha para o registo ou início de sessão e regressa à mesma rua após o acesso. Se a sessão expirar durante o preenchimento, texto e fotografias continuam em memória durante a navegação para o acesso por email; não sobrevivem a uma atualização da página ou saída para um fornecedor social. Não existe envio offline. Uma falha de rede mantém o formulário e indica que deve consultar os conteúdos antes de repetir um envio sem confirmação.

É possível publicar texto (até 5000 caracteres), fotografias ou ambos. Cada publicação aceita até quatro imagens JPEG, PNG ou WebP, de 8 MiB cada. A câmara traseira é sugerida com `capture="environment"`; a disponibilidade e a interface da câmara dependem do dispositivo e navegador. A seleção de imagens existentes funciona num botão separado. HEIC não é suportado nesta etapa.

Apenas os recursos estáticos da PWA entram na cache do service worker. Conteúdos são consultados pela rede e as fotografias públicas usam a cache HTTP definida pela API. Não há um mapa ou catálogo de conteúdos pré-descarregados.

## Camadas administrativas

O seletor «Limites administrativos» permite ativar separadamente ou em conjunto:

| Camada | Cor | Zoom mínimo |
| --- | --- | --- |
| Distritos | Roxo | 5 |
| Concelhos | Ocre | 8 |
| Freguesias | Verde azulado, tracejado | 11 |

As camadas começam desligadas e são carregadas apenas quando selecionadas e com zoom suficiente. Ao selecionar uma área, aparece o nome, código administrativo, concelho/distrito quando disponíveis e atribuição à fonte. Os limites aparecem por cima da cartografia e abaixo do marcador de localização.

Fonte: **Direção-Geral do Território — CAOP 2025**, licença CC BY 4.0. Os mosaicos vetoriais são consultados no [serviço OGC API oficial](https://ogcapi.dgterritorio.gov.pt/), coleções `distritos`, `municipios` e `freguesias`, usando WebMercatorQuad. A [CAOP](https://www.dgterritorio.gov.pt/atividades/cartografia/cartografia-tematica/caop) é mantida pela DGT.

**Cobertura desta versão: Portugal continental.** Os Açores e a Madeira não estão incluídos nas três coleções verificadas; essa limitação fica visível na interface. As versões da divisão administrativa correspondem à edição identificada, não a uma classificação inferida a partir do OpenStreetMap.

O navegador pede os mosaicos ao servidor da própria app em `/map-data/:colecao/:z/:x/:y.pbf`. Não precisa de acesso à API, MongoDB ou autenticação. O servidor aceita apenas as três coleções e coordenadas válidas até zoom 14, ajustando a ordem linha/coluna do serviço DGT. Leaflet amplia os mosaicos do zoom 14 para níveis superiores. Não são descarregados os polígonos completos do país.

Existe cache HTTP de uma hora e cache em memória limitada a 128 mosaicos / 16 MiB, com agregação de pedidos iguais e máximo de quatro consultas DGT simultâneas. Cada consulta à fonte tem um limite de 25 segundos. Mosaicos superiores a 2 MiB e respostas inválidas são rejeitados. Uma falha temporária tem uma repetição automática no navegador; falhas persistentes mostram uma mensagem e permitem tentar novamente.

Os erros pertencem apenas aos mosaicos da área visível. Ao arrastar ou aproximar o mapa, pedidos de áreas abandonadas são cancelados e os seus erros deixam de afetar a nova vista. O servidor retira pedidos cancelados da fila e interrompe a consulta externa se já não houver outro utilizador à espera do mesmo mosaico. Não cancela pedidos partilhados por utilizadores que ainda precisam desses dados. Os logs de falha identificam a camada e o tipo de erro (tempo excedido, erro HTTP ou resposta inválida), sem credenciais ou dados da conta.

Desativar uma camada ou abrir a conta retira-a do mapa; a seleção mantém-se ao regressar. As verificações de navegador incluem emulação Android, zoom ao nível da rua, recuperação automática e recuperação após erro ao mudar de área.

Leaflet.VectorGrid é servido localmente. Não há novas variáveis de ambiente a configurar nem alterações necessárias no serviço API para estas camadas. A atribuição fica disponível no seletor e no mapa enquanto as camadas estiverem ativas. Os testes usam pequenas amostras oficiais, identificadas em `test/fixtures/README.md`, sem pedidos automáticos aos servidores públicos.

## PWA e cartografia

O manifesto, ícones e service worker permitem abrir a interface sem rede depois da primeira visita com ligação. API e cartografia requerem rede. A cache da PWA inclui apenas ficheiros estáticos e bibliotecas; não guarda respostas da API, dados da conta, mosaicos OSM nem mosaicos administrativos.

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

O workflow de CI instala dependências com `npm ci` e verifica ficheiros públicos e proxy HTTP, incluindo cookies, origens, redirecionamentos e falhas da API. Verifica também validação, cache, ordem das coordenadas e erros do serviço de limites administrativos. Os testes de integração de navegador no workspace cobrem seleção das camadas, geometrias e nomes reais, zoom mínimo, coexistência no telemóvel e recuperação após falha.
