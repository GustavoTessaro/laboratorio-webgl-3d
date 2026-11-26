# Plano de implementação · Laboratório WebGL 3D V2

**04/12/2026** é a entrega da versão funcional. **11/12/2026** é a apresentação final. O [PRD](prd-v2.md) define o aceite e o [TDD](tdd-v2.md) registra as propostas técnicas. A numeração identifica as etapas. Testes e revisão acadêmica começam junto com as primeiras entregas e se repetem antes de fechar a versão.

## Etapas e dependências

| Etapa | Depende de | Critério de conclusão |
|---|---|---|
| **V2-00 · Auditoria técnica — concluída** | V1 | Inventário do código e dos recursos gráficos, lacunas, riscos colaborativos e cobertura dos testes existentes. |
| **V2-01 · Documentação e planejamento** | V2-00 | PRD, TDD e plano alinhados com as datas, exigências acadêmicas, alternativas técnicas e corte de escopo. |
| **V2-02 · Estabilização da edição e animação** | V2-01 | Transformação base separada da pose visual, pausa transitória do gizmo, rotação retomada ao soltar, uma confirmação por gesto alterado e zero gravações durante reprodução. Validar regra espacial comum e reconexão durante edição. |
| **V2-03 · Arquitetura gráfica e organização da interface** | V2-02 | Extrair responsabilidades de `main.js` e `scene.js` em passos verificáveis. Separar módulos de cena, edição e painel por categoria, preservando seleção, limites e bloqueios. |
| **V2-04 · Geometrias parametrizáveis e novas formas** | V2-02, V2-03 | Parametrizar as formas existentes com orçamento de subdivisões, preservar defaults V1 e adicionar novas formas a partir do catálogo. Verificar duplicação, mudança de tipo, snapshot remoto e reinício. |
| **V2-05 · Materiais PBR e texturas de imagem** | V2-03, V2-04 para as novas formas | Demonstrar Basic, Phong e Standard, cores, sólido/aramado, rugosidade, metalicidade e opacidade. Aplicar pelo menos uma imagem por referência e verificar a restauração em outro cliente e após reinício. |
| **V2-06 · Iluminação avançada e sombras** | V2-03, V2-05 para verificação visual | Demonstrar sombra direcional no plano receptor. Incorporar iluminação ambiente, hemisférica, direcional, pontual e spot, com controles aplicáveis e ajuste do custo das sombras. |
| **V2-07 · Câmeras e sistemas de coordenadas locais e globais** | V2-03 | Alternar perspectiva e ortográfica, focar o objeto, selecionar vistas predefinidas e operar o gizmo em espaço local ou global. Verificar resize, raycast e independência entre os clientes. |
| **V2-08 · Sistema de partículas** | V2-02, V2-03 | Demonstrar uma fonte na primeira entrega. Completar chuva, neve, galáxia e limites de emissão. Verificar execução local, compartilhamento de configuração quando aplicável e descarte. |
| **V2-09 · Inspetor de Computação Gráfica** | V2-04, V2-07 | Mostrar vértices, triângulos, wireframe, normais e matrizes local e global do objeto, além de FPS e draw calls. Verificar que a inspeção individual preserva o material compartilhado. |
| **V2-10 · Curvas e trajetórias de animação** | V2-02, V2-03 | Demonstrar movimento circular, elíptico, helicoidal, Bézier e Catmull-Rom, com controles, restrições de área e recuperação da configuração. O movimento circular pode servir como recurso avançado da primeira entrega se validado primeiro. |
| **V2-11 · Modelagem por revolução e extrusão (opcional)** | V2-04, V2-10 quando reutilizar curvas | Gerar malhas a partir de perfis, validar pontos, segmentos e limites e verificar o descarte na edição. |
| **V2-12 · Ambientes predefinidos (opcional)** | V2-05, V2-06 | Aplicar um preset de ambiente de forma reproduzível e verificar a restauração se ele for compartilhado. |
| **V2-13 · Shaders personalizados (opcional)** | V2-05, V2-15 para a validação final | Demonstrar um preset com uniforms, tratamento de erro de compilação e verificação do custo. |
| **V2-14 · Importação de modelos GLTF/GLB (opcional)** | V2-03, V2-04, V2-05 | Importar um modelo de referência, validar tamanho, hierarquia e limites espaciais e definir seleção, descarte e política de ativos. |
| **V2-15 · Testes integrados e otimização** | Contínua desde V2-02. Para fechar, exige P0 integrada. | Executar testes JS e .NET, build, dois navegadores e medições gráficas e de sincronização. Verificar migração e recuperação em ambiente de teste quando houver alteração de schema. |
| **V2-16 · Revisão dos requisitos acadêmicos** | V2-15 para o escopo da entrega | Registrar uma evidência para cada requisito do PRD, revisar qualidade visual, interação e animação e ensaiar pelo menos um recurso avançado. |
| **V2-17 · README e publicação final** | V2-16 e validação da ordem de publicação | Documentar uso, requisitos e roteiro de demonstração. Publicar na ordem validada, verificar entrada na sala e recuperação da cena, e preparar uma demonstração no modo local. |

## Corte de escopo e marcos

- **26 a 29/11 · estabilizar e preparar.** Priorizar V2-02 e as extrações de V2-03 necessárias ao P0. Usar os testes V1 como referência. Definir a regra espacial e testar o fluxo de confirmação antes de expandir DTOs.
- **30/11 a 02/12 · integrar os requisitos visuais.** Priorizar a primeira geometria parametrizável, os materiais, a opacidade, a imagem de referência, a sombra e as duas projeções. Validar uma fonte de partículas ou uma trajetória circular como recurso avançado.
- **03 a 04/12 · fechar a versão funcional.** Congelar o escopo P0, executar V2-15 e V2-16 sobre esse recorte e corrigir regressões de entrega. Se houver atraso, reduzir variedade de formas, luzes, emissores, vistas e trajetórias, preservando os critérios acadêmicos e a recuperação da sala.
- **05 a 11/12 · preparar a apresentação.** Selecionar incrementos P1 que possam ser verificados antes da apresentação. Priorizar roteiro demonstrável, revisão final e documentação da versão publicada. V2-11 a V2-14 ficam fora do caminho crítico.

## Checklist de acompanhamento

- [x] V2-00 concluída com auditoria técnica e inventário de regressões.
- [x] V2-01 documentada com PRD, TDD e plano incremental.
- [ ] V2-02 verificada com gizmo, bloqueio, cancelamento, reconexão e contagem de gravações.
- [x] V2-03 implementada e validada nas suítes automatizadas e no Chrome headless em modo local.
- [ ] V2-03 a V2-07 entregues no recorte P0, com os critérios visuais e colaborativos registrados.
- [ ] Pelo menos um recurso avançado demonstrável em V2-08 ou V2-10.
- [ ] V2-08 a V2-10 acompanhadas por incremento, com itens P1 adiados identificados.
- [ ] V2-11 a V2-14 avaliadas individualmente conforme disponibilidade.
- [ ] V2-15 com resultados dos testes, build, medições e recuperação da sala.
- [ ] V2-16 com evidências dos dez requisitos, qualidade visual, interação, animação e recurso avançado.
- [ ] V2-17 com README, ordem de publicação verificada e demonstração pronta para 11/12.

## Registro da V2-02

A implementação mantém a transformação base separada da pose visual e conserva `animation.enabled` durante o gizmo. A edição aplica à base o deslocamento produzido pelo gizmo, a rotação relativa ou a escala escolhida. Ao confirmar uma manipulação com mudança, a reprodução recomeça a partir da nova base. Ativar ou trocar de eixo começa na base, desativar volta à base e mudar a velocidade mantém a fase local. Alterações de cor e material preservam a base e a fase. O frontend e o backend usam as mesmas semidimensões conservadoras e tolerância de 0,000001 para as formas atuais.

Cor personalizada e velocidade têm prévia local e uma confirmação por gesto alterado. O reset de aparência confirma cor e modo em uma operação. O gizmo conserva as prévias compartilhadas de 100 ms, invalida prévias ainda na fila ao terminar e serializa a confirmação após qualquer prévia já em trânsito. O servidor difunde prévias sem incluí-las no snapshot confirmado ou no SQL e restaura a versão confirmada para os participantes quando um bloqueio com prévia é encerrado sem confirmação. Na reconexão, a fila descarta prévias e compara confirmações pendentes com o snapshot da sala para evitar reaplicar uma edição sobre uma versão divergente. O protocolo e o schema permanecem compatíveis com a V1.

- [x] Suíte JavaScript com 12 testes, incluindo os três modos do gizmo, independência da pose, cor durante animação, ativação e desativação, cancelamento, teclado, reset e invalidação de prévias.
- [x] Build Vite concluído. Permanecem os avisos de anotações do pacote SignalR e de tamanho do bundle.
- [x] Build .NET concluído com zero avisos e suíte completa com 20 testes. O teste de persistência contou gravações no SQLite em memória, incluindo prévia, confirmação sem mudança e confirmação efetiva.
- [x] Integração SignalR via clientes Node.js em localhost e SQLite temporário. Verificou bloqueio concorrente, prévia visível, entrada com snapshot confirmado, confirmação, restauração ao liberar o bloqueio, desconexão durante prévia e retorno à sala.
- [ ] Validar manualmente em dois navegadores o arraste com animação ativa, o seletor de cor nativo, a troca de seleção, o controle de velocidade e a reconexão durante a edição.
- [ ] Verificar recuperação em Azure SQL em ambiente de teste e avaliar cenários de alta latência entre conexões. A comparação de snapshots da V2-02 dispensa revisões no contrato, mas não resolve todos os conflitos entre autores concorrentes.

## Registro da V2-03

O catálogo gráfico agrupa a fábrica, o nome e os limites de cada forma V1. Materiais e luzes padrão têm pontos de criação próprios. O registro de entidades conserva a transformação base, a pose de animação e a aplicação de snapshots. O controle de órbita e o gizmo ficam em um módulo gráfico próprio. `scene.js` coordena câmera, renderer, seleção, rótulos e ciclo de renderização. `main.js` coordena a colaboração e delega os controles da interface ao painel.

As categorias usam `details` e `summary` nativos, com abertura independente. Objetos e participantes continuam visíveis. Posicionamento começa aberto e geometria, aparência, iluminação e animação começam recolhidas. O painel mantém rolagem independente no desktop e, em telas estreitas, fica abaixo da cena com altura limitada.

O encerramento da cena para o loop e o observer, remove listeners e descarta controles, malhas, auxiliares, texturas de presença, mapa de sombras e renderer. A desmontagem não publica exclusões. A página preserva a cena quando o navegador informa que a navegação a colocou no cache de retorno.

- [x] Suíte JavaScript com 14 testes. As novas verificações cobrem a remoção dos listeners do painel, o cancelamento da prévia por bloqueio e o descarte idempotente da cena.
- [x] Build Vite concluído com os avisos de anotações do SignalR e de tamanho do bundle. Build .NET concluído com zero avisos e 20 testes aprovados.
- [x] Chrome headless com WebGL em modo local. Verificou abertura das categorias, criação e seleção de objetos, ativação de animação, rolagem independente e dimensões da cena em 1280 × 840 e 390 × 750. Eventos de saída simulados verificaram a preservação ou desmontagem do canvas conforme o sinal de cache do navegador.
- [ ] Validar em dois navegadores reais o painel com bloqueios, troca de seleção, prévias do gizmo e reconexão. Conferir teclado e toque em dispositivos reais. As pendências de alta latência e Azure SQL da V2-02 permanecem abertas.
