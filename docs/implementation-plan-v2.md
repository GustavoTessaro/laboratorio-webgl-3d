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
- [x] V2-04 implementada e validada com WebGL, SignalR local e migração SQLite.
- [x] V2-05 implementada e validada com WebGL, SignalR local e recuperação após reinício com SQLite.
- [x] V2-06 implementada e validada com WebGL, duas sessões SignalR e recuperação em SQLite.
- [x] V2-07 implementada e validada com WebGL, duas sessões independentes e transformações compartilhadas.
- [x] V2-08 implementada e validada com quatro efeitos, SignalR local e recuperação em SQLite.
- [ ] V2-03 a V2-07 entregues no recorte P0, com os critérios visuais e colaborativos registrados.
- [x] A fonte de partículas da V2-08 é o recurso avançado demonstrável.
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

## Registro da V2-04

O [catálogo de geometrias](../backend/Laboratorio.Collaboration/Contracts/GeometryCatalog.json) é consumido pelo Vite e embutido no projeto .NET. As treze formas têm parâmetros próprios. As quatro formas da V1 mantêm os valores originais e a pirâmide conserva quatro lados. Os limites de subdivisão por eixo garantem até 8.192 vértices e 8.192 triângulos por forma nas fábricas do Three.js r180. O frontend também verifica a contagem produzida. Cliente e servidor usam a caixa conservadora de cada forma, com a mesma ordem Euler e tolerância espacial da V2-02.

Os controles mostram os campos da forma selecionada e permitem restaurar os padrões. Cada gesto ajusta uma prévia local e confirma uma vez se o valor mudar. A confirmação reaproveita a geometria da prévia quando possível. A mudança preserva rotação, escala, aparência e configuração da animação. A posição é preservada quando a nova caixa já cabe na cena. O objeto é deslocado o mínimo necessário quando cruza uma borda e a mudança é rejeitada se a caixa exceder o espaço disponível com a escala e rotação atuais. A duplicação copia os parâmetros confirmados e a troca de forma adota os padrões da nova forma.

O contrato envia `geometryParameters` apenas com os valores diferentes do padrão. A migração aditiva `20261126233514_AddGeometryParameters` acrescenta `GeometryParametersJson`, anulável, como `TEXT` em SQLite e `nvarchar(1024)` em SQL Server. Registros existentes continuam válidos sem preenchimento retroativo. A igualdade por conteúdo evita gravações repetidas e integra parâmetros à reconciliação. O teste de navegador também encontrou e cobriu uma falha anterior no envio da cena inicial. O índice passado por `Array.from` era interpretado como transformação no serializador.

### Publicação e recuperação

O protocolo passa para a versão 2 porque clientes antigos não conseguem renderizar as novas formas. Versões diferentes podem rodar em modo local durante a transição. O hub rejeita o ingresso com protocolo diferente e preserva os dados já salvos. Para a janela de publicação, gerar e revisar o script idempotente com `dotnet ef migrations script 20261016104024_InitialRoomPersistence 20261126233514_AddGeometryParameters --idempotent --project backend/Laboratorio.Collaboration` usando o provider SQL Server. Confirmar o histórico da migração inicial e o backup, aplicar primeiro a coluna aditiva no ambiente de teste, validar a leitura de uma sala antiga, publicar o backend atualizado e em seguida o frontend. Solicitar recarga dos clientes antigos e verificar a entrada de dois participantes. Após o primeiro uso de parâmetros ou formas novas, um retorno ao binário V1 exige um plano de recuperação dos dados. O `Down` remove a coluna e perde os valores nela gravados.

### Resultados e pendências

- [x] Suíte JavaScript com 18 testes, incluindo fábricas e orçamentos das treze formas, parâmetros inválidos, limites rotacionados, compatibilidade V1, prévia, descarte, duplicação e hidratação.
- [x] Build Vite concluído com os avisos de anotações do SignalR e de tamanho do bundle. Build .NET concluído com zero avisos e 35 testes aprovados.
- [x] Migração SQLite aplicada a um registro com schema V1. Verificadas a persistência após reinício, uma gravação para a mudança confirmada e zero para a prévia e para uma confirmação equivalente.
- [x] Script idempotente SQL Server gerado e revisado sem conexão com o banco. O script acrescenta a coluna anulável e registra a migração no histórico.
- [x] Chrome headless com WebGL em modo local e sessões colaborativas em localhost. Verificados seleção e criação das treze formas, campos do nó toroidal, prévia visível só no autor, confirmação compartilhada, duplicação, restauração dos padrões e hidratação em nova sessão.
- [ ] Ensaiar publicação coordenada e retorno em ambiente de teste com SQL Server e conferir interação por toque e teclado em dispositivos reais. As pendências anteriores de alta latência continuam abertas.

## Registro da V2-05

A categoria Aparência oferece Basic, Phong e Standard PBR. Standard conserva os valores da V1, com rugosidade 0,38 e metalicidade 0,12. A troca de modelo mantém as propriedades comuns e guarda os ajustes específicos para quando seu modelo voltar a ser usado. A opacidade abaixo de 1 habilita a transparência automaticamente. Os controles de mapeamento aparecem quando há textura. A restauração do mapeamento preserva a imagem, e a restauração de aparência volta ao Standard e remove o mapa.

O catálogo reúne sete mapas de cor do ambientCG sob CC0 e um quadriculado UV original. As oito imagens locais de 512 × 512 servem para as miniaturas e para o `TextureLoader`. O renderizador usa sRGB para mapas de cor. Cada objeto tem repetição, deslocamento e rotação próprios e compartilha a fonte de imagem com outros usuários do mesmo ativo. Recursos são liberados quando deixam de ser usados. Em caso de falha, o material continua exibindo a cor base. A procedência e os créditos estão em [Origem das texturas](texture-assets.md).

As prévias de propriedades contínuas são locais. O fim do gesto confirma apenas uma alteração efetiva. Duplicação, cópia de propriedades, snapshots e reconciliação incluem as configurações de aparência. A verificação em duas sessões detectou uma corrida no eco de criação que podia reverter uma textura aplicada logo após criar o objeto. A criação agora usa o mesmo tratamento de confirmações locais que a atualização.

### Contrato e publicação

`materialSettings` é opcional. Na ausência do campo, o laboratório usa o Standard com os padrões legados. O servidor valida os modelos, faces, cores, limites e IDs do catálogo. A migração `20261126235231_AddMaterialSettings` acrescenta `MaterialSettingsJson` anulável, como `TEXT` no SQLite e `nvarchar(1024)` no SQL Server. A cor, o modo de wireframe e os parâmetros geométricos permanecem nos campos existentes.

O protocolo passa para **3**. Um cliente V2 enviaria o objeto inteiro sem as novas propriedades e poderia sobrescrever a aparência. Para publicar, revisar e ensaiar o script idempotente de `AddGeometryParameters` até `AddMaterialSettings` com o provider SQL Server. Se o ambiente ainda estiver no schema V1, incluir também a migração de geometria. Após backup e validação de leitura, publicar backend e frontend em janela coordenada e solicitar recarga dos clientes. Reverter o schema via `Down` remove o JSON de aparência. Preservar a coluna ou restaurar o backup conforme o plano de recuperação.

### Resultados e pendências

- [x] JavaScript com 23 testes. Inclui os três tipos, propriedades, prévias, mapeamento independente, cópia, duplicação, fallback, hidratação e descarte.
- [x] Build Vite concluído com os avisos de anotações do SignalR e tamanho do bundle. Build .NET concluído com zero avisos e 37 testes aprovados.
- [x] SQLite validou a migração de dados V1 e V2, a preservação dos parâmetros de geometria, zero gravações em prévia e confirmação equivalente, e recuperação após reinício.
- [x] SQL Server com script idempotente gerado e modelo conferido no EF. A execução da migração em SQL Server permanece pendente.
- [x] Chrome headless com WebGL validou a renderização dos três materiais, oito miniaturas, texturas em cubo e esfera, controles contextuais, transparência, prévias locais, confirmação em duas sessões SignalR e recuperação após reiniciar o backend. O modo local foi exercitado com aplicação de textura e reset de aparência.
- [ ] Conferir ordenação visual de objetos transparentes sobrepostos, toque e teclado em dispositivo real. Ensaiar publicação e retorno em SQL Server de teste.

## Registro da V2-06

A categoria Iluminação reúne ambiente, hemisférica, direcional, pontual e focal. Cada luz pode ser ativada e restaurada separadamente. A hemisférica e a direcional conservam as cores, intensidades e posições anteriores. As demais começam desativadas, o piso começa oculto e a grade permanece visível. O piso receptor fica 0,015 unidade abaixo da grade e tem cor própria. Os auxiliares permanecem no navegador, fora da seleção de objetos e do estado compartilhado. A câmera de sombra pode ser visualizada para a direcional e a focal. A sombra da pontual cobre seis direções e o auxiliar mostra a luz, sem exibir apenas uma face da câmera como se representasse toda a projeção.

O [catálogo compartilhado](../backend/Laboratorio.Collaboration/Contracts/LightingCatalog.json) define os padrões e limites da interface e da validação do servidor. Os níveis baixo, médio e alto usam respectivamente 512/1024/2048 para direcional, 512/1024/1024 para focal e 128/256/256 por face para pontual. Há um teto adicional pela capacidade do renderer. A câmera direcional enquadra a área de trabalho e as câmeras de perspectiva acompanham o alcance. Bias negativo e normalBias positivo reduzem artefatos. Mudança de resolução ou desligamento descarta o mapa anterior. O encerramento libera luzes, auxiliares, mapas e geometria e material do piso.

### Colaboração e publicação

A iluminação e o ambiente têm revisão própria no snapshot da sala. Um gesto contínuo usa prévia local e envia um comando ao confirmar uma alteração efetiva. A prévia é descartada ao desconectar. Confirmações pendentes são reenviadas após a reconexão com a sala. O servidor serializa a gravação, combina alterações em campos distintos e usa a última confirmação para o mesmo campo. Um reset substitui o grupo inteiro ou toda a iluminação. O cliente ignora revisões atrasadas. O modo local permite simular livremente. Ao ingressar numa sala, seu snapshot é a referência compartilhada.

O protocolo passa para **4** para que clientes na mesma sala observem também as mudanças de iluminação. A migração `20261127000611_AddRoomLighting` acrescenta `LightingJson` a `Rooms`, como `TEXT` em SQLite e `nvarchar(2048)` em SQL Server, com valor nulo permitido. Salas antigas usam os padrões. O servidor só atualiza o estado confirmado após comprovar a gravação e mantém a recuperação por leitura quando a confirmação do SQL é incerta. Para publicar, revisar e ensaiar o script idempotente de `AddMaterialSettings` até `AddRoomLighting` com SQL Server, validar a leitura das salas existentes após backup e publicar backend e frontend em janela coordenada. O `Down` remove apenas a coluna de iluminação, incluindo suas configurações.

### Resultados e pendências

- [x] JavaScript com 28 testes, incluindo configuração das cinco luzes, validação, restauração, projeção e recursos de sombra, descarte, prévias, revisões concorrentes e reconexão.
- [x] Build Vite concluído com os avisos de anotações do SignalR e tamanho do bundle. Build .NET concluído com zero avisos e 39 testes aprovados.
- [x] SQLite validou migração de sala legada, mesclagem de campos concorrentes, ausência de gravações repetidas, confirmação de uma escrita com resposta perdida e recuperação após reinício.
- [x] O EF gerou o script idempotente para SQL Server e confirmou o modelo. A aplicação em SQL Server de teste permanece pendente.
- [x] Chrome headless com WebGL verificou cinco fontes simultâneas, sombras na direção, no foco e na pontual, diferenças de pixels no piso ao alternar a sombra, Basic sem resposta à direcional e resposta de Phong e Standard. Dois clientes verificaram prévia local, atualizações concorrentes, auxiliares individuais e recuperação depois de reiniciar o backend.
- [ ] Medir o custo das sombras simultâneas em hardware real, especialmente as seis direções da pontual. Conferir artefatos de sombra, controles em dispositivos de toque e publicação coordenada em SQL Server de teste.

## Registro da V2-07

A câmera em perspectiva continua sendo o padrão, com FOV de 50°, posição (4, 3, 5) e alvo (0, 0,5, 0). Renderização, resize, raycasting, OrbitControls e TransformControls usam a câmera ativa. A troca conserva direção, alvo e escala aparente no plano do alvo dentro dos limites de navegação. O FOV pode variar de 25° a 85° e o zoom ortográfico de 0,25× a 4×. O zoom ortográfico volta a 1× quando a projeção é recalibrada pela troca ou por um enquadramento. Editar o alvo desloca câmera e alvo juntos sem alterar a orientação.

A convenção é X vermelho, Y verde para cima e Z azul. As vistas indicam de onde a câmera observa o alvo. Frontal vem de +Z, traseira de −Z, superior de +Y, inferior de −Y, esquerda de −X e direita de +X. Superior e inferior usam um pequeno desvio em +Z para manter a orientação estável no OrbitControls. A vista isométrica usa a diagonal (+X, +Y, +Z). Com a projeção ortográfica, essa vista mantém as proporções sem convergência. O enquadramento usa a caixa calculada a partir dos vértices da malha em coordenadas de mundo, incluindo dimensões parametrizadas, rotação e escala. Uma cena vazia mantém a câmera atual.

O gizmo usa os modos World e Local do Three.js. A escala usa sempre os eixos locais e conserva a preferência para translação e rotação. Durante um gesto, o deslocamento de eixo e a rotação local são reaplicados na base do objeto mesmo quando o gizmo partiu de uma pose animada. Os movimentos livres seguem as convenções do Three.js. A troca de câmera e de coordenadas espera o fim de um arraste em andamento. Os eixos opcionais são auxiliares independentes das malhas e acompanham a pose visual da seleção. Essas preferências ficam na sessão do navegador. O contrato, protocolo e schema da sala permanecem iguais.

### Resultados e pendências

- [x] JavaScript com 34 testes. Inclui projeções, enquadramento e alvo, sete vistas, raycast, resize, limites, cena vazia, operações locais e globais em objetos animados, descarte e ausência de publicação em mudanças visuais.
- [x] Build Vite concluído com os avisos de anotações do SignalR e tamanho do bundle. Build .NET concluído com zero avisos e 39 testes aprovados.
- [x] Chrome headless com WebGL verificou as sete vistas, órbita e seleção por clique nas duas projeções, enquadramento de objetos com tamanhos distintos e o painel em viewport móvel. Dois clientes SignalR locais mantiveram câmeras e preferências independentes. Arrastes nativos do gizmo confirmaram uma translação global em perspectiva e uma local em ortográfica. As ações visuais não enviaram invocações SignalR no teste.
- [ ] Validar navegação por toque e teclado em dispositivos reais e verificar a preservação do enquadramento em viewports extremamente estreitos. Permanecem as pendências de SQL Server e desempenho gráfico das etapas anteriores.

## Registro da V2-08

A fonte é o recurso avançado escolhido para a apresentação. Ela usa emissão ascendente, dispersão, uma equação balística com gravidade e reciclagem ao completar a vida útil ou voltar à altura do emissor. A chuva cai continuamente com vento no eixo X. A neve acrescenta oscilações laterais. A galáxia distribui os pontos em braços espirais e gira em torno do eixo Y. A mesma semente gera os mesmos parâmetros iniciais. A fase de reprodução é própria de cada navegador.

O catálogo compartilhado limita a sala a quatro efeitos, 5.000 pontos por efeito e 12.000 pontos configurados no total, incluindo efeitos desativados. O emissor aceita X e Z de −10 a 10 e Y de 0 a 10. A área meteorológica é quadrada, centrada no emissor, e o vento faz os pontos retornarem pela borda do lado oposto. O raio da galáxia é limitado a 8. A região visual pode ultrapassar a grade. Os efeitos são independentes das malhas e dos limites usados pelo gizmo e pelo enquadramento.

Cada efeito usa um `THREE.Points` com `BufferGeometry`, `BufferAttribute` dinâmico, `PointsMaterial` e buffers `Float32Array` reutilizados. A capacidade reservada é de 5.000 posições por emissor e até 20.000 posições em buffers, com draw range limitado ao total configurado. A reprodução atualiza apenas o trecho usado do atributo de posição; o delta é limitado a 50 ms. O tamanho em tela respeita o limite de pontos do WebGL e o pixel ratio. Os pontos usam recorte suave, depth test ativo, depth write desativado e blending aditivo na galáxia. A remoção e a desmontagem descartam buffers, materiais e textura compartilhada.

### Colaboração e publicação

A sala transmite comandos de criação, edição por campo, restauração e remoção. A ativação é compartilhada. Pausar, reproduzir ou reiniciar o relógio de um efeito é local. Prévia, posições e velocidades simuladas ficam no cliente. O servidor combina alterações em campos distintos e valida o orçamento antes da confirmação durável. No mesmo campo vale a última confirmação. Comandos sem mudança efetiva dispensam gravação. As revisões ignoram mensagens atrasadas e a fila de configurações é compartilhada como implementação entre iluminação e partículas, com estados independentes.

O protocolo passa para **5**, de modo que participantes na mesma sala possam observar os efeitos compartilhados. A migração `20261127004156_AddRoomParticles` acrescenta a coluna anulável `Rooms.ParticlesJson`, como `TEXT` em SQLite e `nvarchar(2048)` em SQL Server. Uma sala legada começa sem efeitos e preserva iluminação e entidades. Para publicar, revisar o script idempotente de `AddRoomLighting` até `AddRoomParticles`, validar a leitura após backup e publicar backend e frontend em janela coordenada. O `Down` remove as configurações de partículas.

### Resultados e pendências

- [x] JavaScript com 40 testes. Inclui determinismo, delta, gravidade e vento, reciclagem, reprodução local, orçamento, descarte e uma única confirmação por gesto.
- [x] Build Vite concluído com os avisos de anotações do SignalR e tamanho do bundle. Build .NET concluído com zero avisos e 41 testes aprovados.
- [x] SQLite validou migração da sala legada, recuperação após reinício, mesclagem, resposta perdida recuperada e ausência de gravações redundantes. O EF gerou o script idempotente de SQL Server e conferiu o modelo.
- [x] Chrome headless com WebGL verificou os quatro efeitos, prévia da fonte, pausa local, ativação e remoção compartilhadas, duas projeções, textura, sombra, recuperação após reinício e modo local. A amostra no orçamento de 12.000 pontos não gerou invocações SignalR.
- [x] Uma amostra de 90 intervalos de quadro em Chrome headless com SwiftShader, canvas de 808 × 567, câmera ortográfica, 12.000 pontos, uma malha texturizada e sombra direcional registrou mediana de 33,4 ms e percentil 95 de 38,1 ms. São intervalos entre quadros do cenário completo em renderização por software.
- [ ] Medir em GPU e dispositivos móveis reais. Verificar sobreposição transparente em cenas densas, controles por toque e publicação em SQL Server de teste.
