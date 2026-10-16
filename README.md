# Laboratório WebGL 3D

Aplicação didática interativa para explorar gráficos 3D no navegador. O
laboratório permite modificar formas, aparência, iluminação e rotação em tempo
real.

## Funcionalidades

- Seleção entre cubo, esfera, pirâmide de base quadrada e toroide.
- Personalização da cor com opções predefinidas e seletor de cor personalizado.
- Alternância entre material sólido e aramado.
- Controles de intensidade e posição das luzes da cena.
- Animação de rotação com velocidade ajustável e seleção dos eixos X, Y e Z.
- Câmera interativa com `OrbitControls`, incluindo órbita, zoom e deslocamento limitado.
- Colaboração opcional em tempo real por SignalR, com sala compartilhada, participantes e bloqueio de edição por objeto.

## Tecnologias

- HTML e CSS para a estrutura e a interface responsiva.
- JavaScript para os controles e a lógica da aplicação.
- Vite para desenvolvimento local e build de produção.
- Three.js para compor e renderizar a cena 3D usando WebGL.
- ASP.NET Core e SignalR para a colaboração em tempo real, com estado em memória e persistência via Entity Framework Core.
- SQLite para desenvolvimento local e SQL Server como provedor configurável.

## Requisitos

- Node.js 20.19+ ou 22.12+
- npm
- Navegador com suporte a WebGL

## Executar localmente

```sh
npm install
npm run dev
```

O Vite informa no terminal o endereço local para abrir no navegador.

## Colaboração local

O frontend continua funcionando no modo local quando o servidor não está disponível. Para compartilhar a sala:

1. Inicie o backend em um terminal:

   ```sh
   dotnet run --project backend/Laboratorio.Collaboration --launch-profile http
   ```

   O hub SignalR ficará em `http://localhost:5080/hubs/laboratory`.

2. Inicie o frontend em outro terminal:

   ```sh
   npm run dev
   ```

3. Abra o endereço informado pelo Vite em dois navegadores ou perfis independentes. Em cada um, escolha **Entrar na sala**, informe um nome de exibição e conecte-se. A sala inicial compartilhada tem o identificador `laboratorio-principal`.

O cenário da sala `laboratorio-principal` é persistido no SQLite em `backend/Laboratorio.Collaboration/App_Data/laboratorio-collaboration.db` e restaurado antes de o servidor aceitar conexões. A aplicação aplica as migrations do EF Core na inicialização; para aplicar migrations manualmente:

```sh
dotnet tool install --global dotnet-ef --version 10.0.9
dotnet ef database update \
  --project backend/Laboratorio.Collaboration \
  --startup-project backend/Laboratorio.Collaboration
```

### Desenvolvimento com SQL Server LocalDB

SQLite continua sendo o provider padrão no perfil `http`. Para executar com SQL Server LocalDB, use o perfil dedicado:

```powershell
dotnet run --project backend\Laboratorio.Collaboration --launch-profile localdb
```

Esse perfil usa `(localdb)\MSSQLLocalDB`, banco `LaboratorioWebGLDb` e migrations automáticas no startup em Development. Ele não inclui credenciais e não altera a configuração de produção. Para aplicar/verificar as migrations sem iniciar o servidor:

```powershell
$env:Persistence__Provider = 'SqlServer'
$env:ConnectionStrings__RoomDatabase = 'Server=(localdb)\MSSQLLocalDB;Database=LaboratorioWebGLDb;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true'
dotnet ef migrations script --project backend\Laboratorio.Collaboration --startup-project backend\Laboratorio.Collaboration --idempotent
dotnet ef database update --project backend\Laboratorio.Collaboration --startup-project backend\Laboratorio.Collaboration
```

Para voltar ao SQLite, encerre o backend iniciado no perfil `localdb` e use `--launch-profile http` ou remova as variáveis `Persistence__Provider` e `ConnectionStrings__RoomDatabase` do processo. O SQLite permanece em `App_Data`; o LocalDB usa o banco local acima.

A migration inicial existente escolhe tipos SQLite (`TEXT`, `REAL`, `INTEGER`) ou SQL Server (`nvarchar`, `float`, `bit`, `datetime2`) por `ActiveProvider`. O script SQL Server deve ser gerado/inspecionado antes de aplicá-la a um destino SQL Server; o histórico de migrations é criado pelo EF Core em `dbo.__EFMigrationsHistory`. O snapshot EF atual foi originalmente gerado pelo provider SQLite e conserva tipos SQLite: não o use como prova de equivalência para futuras alterações do modelo. Antes de criar novas migrations para evoluir ambos os providers, alinhe e verifique snapshots/geração por provider (ou mantenha conjuntos de migrations separados). Schema Compare deve comparar o banco `LaboratorioWebGLDb` com o banco-alvo correto, revisar cuidadosamente tipos, chaves e cascatas, excluir `dbo.__EFMigrationsHistory` das alterações propostas e nunca publicar operações destrutivas ou alterações de dados sem revisão.

Para criar uma migration após uma futura alteração no modelo:

```sh
dotnet ef migrations add NomeDaMigration \
  --project backend/Laboratorio.Collaboration \
  --startup-project backend/Laboratorio.Collaboration \
  --output-dir Data/Migrations
```

SQLite é o provedor padrão e não exige serviços externos. Para selecionar SQL Server, configure `Persistence__Provider=SqlServer` e `ConnectionStrings__RoomDatabase` no ambiente do processo; por exemplo, no PowerShell, defina essas variáveis antes do `dotnet run`. A connection string não é armazenada no repositório. Não configure SQL Server para o uso local padrão.

Criações, exclusões e edições finais são confirmadas no banco antes de serem confirmadas aos participantes. Os movimentos intermediários do gizmo continuam sendo transmitidos em tempo real, mas não são gravados individualmente; apenas a edição final é consolidada. Se a persistência falhar, a chamada SignalR retorna erro explícito, a operação é revertida no estado do servidor para a última versão persistida e os participantes recebem a versão autoritativa. A aplicação registra a falha. Um erro de migração ou leitura impede a inicialização do backend em vez de servir um snapshot incompleto.

O navegador conserva operações offline na fila já existente e as reconcilia com o snapshot recebido ao reconectar: IDs existentes são atualizados e novos IDs são criados uma única vez. Participantes e bloqueios permanecem transitórios e não são gravados. O servidor valida versão do protocolo, IDs, geometrias, propriedades, escala, limites tridimensionais e propriedade dos bloqueios. Os bloqueios expiram após 20 segundos sem renovação e são liberados ao desconectar.

Para testar em outro dispositivo da rede local, inicie o Vite com `npm run dev -- --host 0.0.0.0`, defina `VITE_COLLABORATION_URL` para `http://<IP-DO-COMPUTADOR>:5080/hubs/laboratory` antes de iniciar o frontend e adicione `http://<IP-DO-COMPUTADOR>:5173` ao array `FrontendOrigins` em `backend/Laboratorio.Collaboration/appsettings.json`. O valor padrão do hub para testes no mesmo computador é `http://localhost:5080/hubs/laboratory`.

### Testes e build do backend

```sh
dotnet test backend/Laboratorio.Collaboration.Tests
dotnet build backend/Laboratorio.Collaboration
```

As entidades compartilhadas usam um DTO versionado separado das instâncias Three.js. `RoomStateStore` concentra as regras e o estado transitório da sala; `RoomPersistenceService` coordena migrations, recuperação e gravação do estado persistente pelo EF Core. A tabela de entidades inclui o identificador da sala para permitir múltiplas salas no modelo de dados, sem disponibilizar gerenciamento de salas nesta etapa.

## Build de produção

```sh
npm run build
npm run preview
```

Os arquivos de produção são gerados na pasta `dist/`.

## Preparar publicação no Azure

A implantação prevista usa Azure Static Web Apps para o frontend, Azure App Service Linux (.NET 10) para o backend e Azure SQL Database. Os workflows de frontend e backend são independentes e publicam em pushes para `main` (ou por `workflow_dispatch`); não criam recursos nem contêm credenciais.

### Configuração necessária

1. Crie/configure os recursos Azure fora deste repositório. Use App Service Linux com runtime .NET 10, Azure SQL Database e Static Web Apps. Mantenha o backend em **uma instância** nesta versão.
2. No App Service, configure:
   - `Persistence__Provider`: `SqlServer`
   - `Persistence__ApplyMigrationsOnStartup`: `false`
   - `ConnectionStrings__RoomDatabase`: connection string da Azure SQL, configurada como segredo no App Service ou obtida de um cofre; nunca a versione.
   - `FrontendOrigins__0`: a origem HTTPS exata do Static Web App, por exemplo `https://<nome>.azurestaticapps.net`, sem caminho, barra final ou curingas. Use índices adicionais (`FrontendOrigins__1`) somente para outras origens HTTPS explicitamente autorizadas.
3. Configure o App Service para **HTTPS Only** e habilite WebSockets. A URL do hub deve usar HTTPS: `https://<nome>.azurewebsites.net/hubs/laboratory`. SignalR negocia WebSockets, com transporte de fallback do cliente se necessário. Como o frontend e a API têm origens diferentes, CORS precisa corresponder exatamente à origem HTTPS do frontend; CORS com credenciais e wildcard não é usado.
4. Aplique as migrations à Azure SQL **antes de iniciar/publicar uma versão que dependa do schema**. No computador/runner que tenha acesso de rede autorizado ao banco, instale a ferramenta EF Core e configure `Persistence__Provider=SqlServer` e `ConnectionStrings__RoomDatabase` no ambiente seguro do processo. Depois execute:

   ```powershell
   dotnet tool install --global dotnet-ef --version 10.0.9
   dotnet ef database update --project backend\Laboratorio.Collaboration --startup-project backend\Laboratorio.Collaboration
   ```

   Não inclua a connection string em scripts versionados nem a exponha em logs. A migration automática no startup fica habilitada em Development e desabilitada por padrão em produção para não exigir permissões de DDL para a identidade da aplicação. O backend ainda precisa conectar e ler o schema no startup; se Azure SQL estiver indisponível ou as migrations não tiverem sido aplicadas, a inicialização falha. O operador de deploy precisa de permissão para migrations; a identidade de runtime pode ter somente os direitos de dados necessários. Configure firewall/rede do SQL para permitir o App Service e o host de migration sem abrir acesso público irrestrito.
5. Em **Settings → Secrets and variables → Actions** do GitHub, configure:
   - Variable `AZURE_WEBAPP_NAME`: nome do App Service.
   - Secret `AZURE_WEBAPP_PUBLISH_PROFILE`: publish profile do App Service.
   - Variable `VITE_COLLABORATION_URL`: URL HTTPS completa do hub, incluindo `/hubs/laboratory`.
   - Secret `AZURE_STATIC_WEB_APPS_API_TOKEN`: token de implantação do Static Web App.
6. Após configurar a origem CORS e aplicar migrations, publique os dois workflows fazendo push para `main`, ou execute cada workflow manualmente em **Actions**. `VITE_COLLABORATION_URL` é incorporada durante o build do frontend; alterá-la exige novo build/publicação. Para publicar manualmente, use `npm ci` e `npm run build` na raiz, e `dotnet publish backend\Laboratorio.Collaboration\Laboratorio.Collaboration.csproj --configuration Release` para o backend.

### Reconexão e limites desta etapa

O cliente SignalR tenta reconectar após desconexões com intervalos de 0, 2, 5 e 10 segundos; após esgotar as tentativas, a colaboração fica desconectada até uma nova tentativa do usuário. Ao reconectar, ele entra novamente na sala e aplica o snapshot antes de reconciliar a fila offline já existente. A fila e edições locais não são duráveis após recarregar/fechar a página.

Sala, participantes e bloqueios são mantidos na memória do backend. Escalar horizontalmente ou usar múltiplas instâncias quebraria a consistência de snapshots, locks e notificações SignalR; mantenha uma única instância e não habilite autoscale nesta versão. Reinícios e deploys desconectam participantes e liberam locks; apenas as entidades persistidas no Azure SQL sobrevivem. Não há Azure SignalR Service, afinidade distribuída, autenticação ou identidade gerenciada nesta etapa.

Antes de habilitar recursos, consulte os preços e limites da região e dos planos escolhidos: App Service e Azure SQL podem gerar cobrança contínua; Static Web Apps depende do plano e tráfego. Monitore custos, compute, armazenamento, logs e largura de banda, e remova/desative recursos de teste quando não forem necessários.
