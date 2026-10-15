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
- Câmera interativa com `OrbitControls`, incluindo órbita e zoom.

## Tecnologias

- HTML e CSS para a estrutura e a interface responsiva.
- JavaScript para os controles e a lógica da aplicação.
- Vite para desenvolvimento local e build de produção.
- Three.js para compor e renderizar a cena 3D usando WebGL.

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

## Build de produção

```sh
npm run build
npm run preview
```

Os arquivos de produção são gerados na pasta `dist/`.
