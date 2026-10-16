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
