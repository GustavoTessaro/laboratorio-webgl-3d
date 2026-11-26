# PRD · Laboratório WebGL 3D V2

O Laboratório WebGL 3D é o trabalho final de Computação Gráfica sobre Three.js. Com autorização do professor, a V2 evolui a versão 1.0 já apresentada para um laboratório educacional interativo e colaborativo. A versão funcional deve estar pronta em **04/12/2026** e a apresentação final será em **11/12/2026**.

O estudante deve conseguir montar uma cena, manipular objetos e observar o efeito de mudanças de projeção, iluminação, material e movimento. A colaboração deve permitir editar a mesma cena em dois navegadores e recuperar o trabalho ao voltar à sala. A referência inicial é a auditoria V2-00 e o comportamento atual de [scene.js](../src/scene.js), [main.js](../src/main.js) e [collaboration.js](../src/collaboration.js).

## Requisitos acadêmicos e aceite

Todos os itens da tabela são obrigatórios para 04/12. A demonstração deve funcionar no modo local. As ações de edição compartilhada também devem ser verificadas em dois navegadores quando aplicáveis.

| Requisito | Critério observável |
|---|---|
| 1. Cena 3D | Abrir o laboratório e visualizar os objetos, a área de trabalho e o enquadramento inicial. Redimensionar a janela mantém a proporção da cena. |
| 2. Geometrias | Criar cubo, esfera, pirâmide e toroide. Editar pelo menos uma dimensão e uma subdivisão de uma forma parametrizável, com realimentação visual e limites nos valores aceitos. |
| 3. Transformações | Selecionar uma malha e transladar, rotacionar e escalar pelo gizmo. A malha continua dentro do espaço de trabalho, inclusive junto ao piso e ao teto. |
| 4. Câmera | Orbitar, aproximar e afastar, trocar entre perspectiva e ortográfica e voltar a enquadrar o objeto selecionado. A seleção e o gizmo operam nas duas projeções. |
| 5. Materiais, cores e opacidade | Alterar a cor e a opacidade de um objeto e observar o resultado na cena. Comparar Basic, Phong e Standard, com rugosidade e metalicidade disponíveis no Standard. Preservar sólido e aramado. |
| 6. Iluminação | Alterar a intensidade de uma luz e observar a diferença num material iluminado. Demonstrar um objeto projetando sombra num plano receptor. |
| 7. Textura de imagem | Aplicar pelo menos uma imagem de referência a um objeto com UVs. A imagem deve aparecer no segundo navegador e após reabrir a sala quando a alteração tiver sido confirmada. |
| 8. Animação | Ativar e desativar a rotação, alterar eixo e velocidade e usar o gizmo de rotação com a animação ativa. Ao soltar, o objeto retoma o movimento e mantém a configuração após recarregar. |
| 9. Interação | Selecionar pela lista ou pela cena, criar, duplicar, remover, copiar e aplicar propriedades. Um segundo participante vê as alterações compartilhadas e recebe indicação quando o objeto está bloqueado. |
| 10. Modularização | A revisão do código identifica módulos com responsabilidades gráficas e de interface claras. A cena, a seleção e a colaboração continuam funcionando pelos pontos de entrada existentes. |

## Escopo e prioridade

| Prioridade | Entrega |
|---|---|
| **P0 · versão funcional** | Fechar os dez critérios acadêmicos, preservar o modo local e a colaboração da V1, e demonstrar **um recurso técnico avançado**. O candidato principal é uma fonte de partículas. A alternativa é uma trajetória circular se estiver validada primeiro. |
| **P1 · ampliação** | Novas formas e parametrização mais ampla, luzes ambiente, hemisférica, direcional, pontual e spot, vistas predefinidas, foco no objeto e escolha entre coordenadas locais e globais. Completar partículas de chuva, neve, fonte e galáxia. Entregar inspetor com vértices, triângulos, wireframe, normais, matrizes local e global, FPS e draw calls. Completar trajetórias circulares, elípticas, helicoidais, Bézier e Catmull-Rom. |
| **P2 · opcional** | Modelagem por revolução e extrusão, ambientes predefinidos, shaders personalizados e importação GLTF/GLB. Entram quando os requisitos acadêmicos e os fluxos colaborativos estiverem verificados. |

## Requisitos não funcionais

- **Usabilidade e qualidade visual.** O painel deve agrupar controles por tarefa, indicar a seleção e mostrar valores e unidades. A demonstração deve tornar visíveis a textura, a opacidade, as sombras e a animação, com enquadramento legível após resize.
- **Integridade colaborativa.** Dois navegadores devem convergir para o mesmo estado confirmado após criar, editar, duplicar ou excluir um objeto. Validar bloqueio concorrente, reconexão e recuperação após reinício. Posição, material e outros atributos dos objetos são compartilhados. Câmeras, inspetor e estatísticas são individuais.
- **Tráfego e persistência.** Reprodução de animações e partículas gera zero mensagens e zero gravações por quadro. Um gesto contínuo que muda o estado deve resultar em uma confirmação durável. Prévias remotas, quando habilitadas, têm frequência limitada e ficam fora do SQL. Texturas trafegam como referências.
- **Compatibilidade e desempenho.** Cenas V1 devem carregar com aparência e comportamento equivalentes. Restringir subdivisões, partículas e auxiliares. Verificar tempo por quadro, draw calls, mensagens e gravações com condições de medição registradas. Repetir criação, substituição e exclusão para detectar crescimento de recursos gráficos.

O [plano de implementação](implementation-plan-v2.md) define o corte de escopo e as evidências de entrega. As propostas de arquitetura e as decisões pendentes estão no [TDD](tdd-v2.md).
