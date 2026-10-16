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
- ASP.NET Core e SignalR para a colaboração em tempo real, com estado mantido em memória.

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

Objetos e operações permanecem apenas na memória do processo do backend; reiniciar o servidor reinicia o estado da sala. O servidor valida versão do protocolo, IDs, geometrias, propriedades, escala, limites tridimensionais e propriedade dos bloqueios. Os bloqueios expiram após 20 segundos sem renovação e são liberados ao desconectar.

Para testar em outro dispositivo da rede local, inicie o Vite com `npm run dev -- --host 0.0.0.0`, defina `VITE_COLLABORATION_URL` para `http://<IP-DO-COMPUTADOR>:5080/hubs/laboratory` antes de iniciar o frontend e adicione `http://<IP-DO-COMPUTADOR>:5173` ao array `FrontendOrigins` em `backend/Laboratorio.Collaboration/appsettings.json`. O valor padrão do hub para testes no mesmo computador é `http://localhost:5080/hubs/laboratory`.

### Testes e build do backend

```sh
dotnet test backend/Laboratorio.Collaboration.Tests
dotnet build backend/Laboratorio.Collaboration
```

As entidades compartilhadas usam um DTO versionado separado das instâncias Three.js. `RoomStateStore` concentra as operações de sala em memória e pode ser substituído futuramente por uma implementação persistente sem acoplar o hub à tecnologia de armazenamento.

## Build de produção

```sh
npm run build
npm run preview
```

Os arquivos de produção são gerados na pasta `dist/`.
