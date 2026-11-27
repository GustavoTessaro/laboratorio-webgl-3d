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
- [x] V2-09 implementada e validada com testes automatizados e Chrome headless. Medições em hardware real permanecem pendentes.
- [x] V2-10 implementada com cinco trajetórias, duas sessões colaborativas locais e recuperação em SQLite.
- [x] V2-11 implementada com revolução e extrusão, dez modelos editáveis e validação compartilhada do catálogo.
- [x] V2-12 implementada com sete demonstrações e aplicação em lote no modo local e colaborativo.
- [x] V2-13 implementada com seis shaders predefinidos, consulta do GLSL e validação espacial da ondulação.
- [x] V2-14 implementada com importação estática local, três exemplos originais e integração colaborativa pelo catálogo.
- [ ] V2-03 a V2-07 entregues no recorte P0, com os critérios visuais e colaborativos registrados.
- [x] A fonte de partículas da V2-08 é o recurso avançado demonstrável.
- [ ] V2-08 a V2-10 acompanhadas por incremento, com itens P1 adiados identificados.
- [ ] V2-11 a V2-14 avaliadas individualmente conforme disponibilidade.
- [ ] V2-15 com resultados dos testes, build, medições e recuperação da sala.
- [x] V2-15B.1 corrigiu o E-01 e confirmou a convergência em duas sessões com SQLite.
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

## V2-09 — Inspetor de Computação Gráfica

- O inspetor lê os atributos reais das treze geometrias. Conta os vértices armazenados no atributo `position`, agrupa posições por coordenadas arredondadas a seis casas decimais e calcula triângulos a partir dos índices ou dos vértices, conforme a topologia.
- Os auxiliares são locais e independentes da seleção e do material. Vértices e normais usam amostras de até 512 elementos cada. As normais usam a inversa transposta da transformação visual para respeitar escala não uniforme. A caixa segue a orientação da malha e a esfera local torna-se um elipsoide visual sob escala não uniforme. Ambas são calculadas a partir da geometria e independem dos limites conservadores de posicionamento.
- As matrizes são apresentadas em linhas e colunas matemáticas a partir do armazenamento column-major. A matriz base vem do registro de objetos e as matrizes local e global acompanham a pose renderizada. As matrizes da câmera ativa e as estatísticas permanecem disponíveis sem seleção.
- A interface atualiza até cinco vezes por segundo e usa os 60 intervalos recentes de quadro. Com o inspetor recolhido, os auxiliares ficam ocultos e a coleta é suspensa. O cache reaproveita buffers e descarta os recursos na troca de geometria, seleção ou encerramento. Os totais do `renderer.info` correspondem ao passe principal na configuração atual do Three.js, podem incluir auxiliares e ficam separados das contagens lógicas de objetos, luzes e partículas.
- Preferências, matrizes e estatísticas ficam no cliente. Contratos, protocolo e persistência compartilhada permanecem compatíveis com as etapas anteriores.

### Resultados e pendências

- [x] 47 testes JavaScript e 41 testes .NET aprovados. Build .NET concluído sem avisos. Build Vite concluído com os avisos de anotações do SignalR e de tamanho do bundle.
- [x] Chrome headless com WebGL verificou as treze geometrias, cinco auxiliares nas duas projeções, alteração de parâmetros, pose animada com matriz base estável, estatísticas com sombras e partículas, painel em viewport móvel e cena vazia. Duas sessões SignalR locais mantiveram preferências independentes, sem invocações do inspetor.
- [x] Medição em Chrome headless com SwiftShader, canvas de 808 × 567, 13 malhas, esfera animada, 1.000 partículas e sombra direcional. Em 60 intervalos por condição, o painel recolhido registrou mediana de 37,9 ms, percentil 95 de 42,5 ms e 29 draw calls. Aberto com os cinco auxiliares, registrou 43,6 ms, 48,8 ms e 34 draw calls. Os resultados abrangem a cena inteira com renderização por software.
- [ ] Medir o impacto dos auxiliares em GPU e dispositivos móveis reais e validar a operação por toque.

## V2-10 — Curvas e trajetórias de animação

### Implementação e decisões

- A categoria Animações separa rotação automática e trajetória. Há cinco tipos, ajustes contextuais, controle de sentido e modos único, contínuo e ida e volta. Em curvas abertas, o modo contínuo retorna diretamente ao início ao completar a travessia. Duração entre 0,5 e 120 s, raios entre 0,05 e 8, altura assinada entre −8 e 8 e de 1 a 8 voltas. Cada coordenada dos pontos varia entre −8 e 8, com quatro pontos para a Bézier e de dois a oito para a Catmull-Rom.
- O centro da curva é relativo à posição base, nos eixos da cena. Círculo, elipse e hélice estendem `Curve`. As splines usam `CubicBezierCurve3` e `CatmullRomCurve3` uniforme com tensão 0,5. Com dois pontos, a Catmull-Rom degenera para um segmento representado por `LineCurve3`. Rejeitamos conjuntos sem duas posições distintas na tolerância de 0,0001. Pontos coincidentes isolados são aceitos. A tabela de 512 divisões aproxima o comprimento de arco, enquanto o auxiliar usa 128 segmentos para exibição.
- Círculo e elipse usam os intervalos analíticos dos raios nos dois eixos do plano. A hélice usa os raios no plano e o intervalo entre zero e a altura assinada no eixo perpendicular. Para a Bézier, usamos a caixa do fecho convexo dos quatro controles. Para a Catmull-Rom, limitamos cada segmento pela caixa do fecho convexo de seus controles Bézier equivalentes. Para um segmento entre Pᵢ e Pᵢ₊₁, os controles internos são Pᵢ + (Pᵢ₊₁ − Pᵢ₋₁)/6 e Pᵢ₊₁ − (Pᵢ₊₂ − Pᵢ)/6, com extrapolação linear nas pontas. Essa expansão cobre excursões além dos pontos informados pelo usuário.
- Frontend e backend somam a envoltória da curva à posição base e expandem por eixo com a caixa conservadora transformada da geometria. Com orientação tangencial ou rotação automática, usam o raio da esfera que contém a caixa escalada em qualquer orientação. Os limites conservadores podem recusar casos cuja malha ou curva real caberia. As amostras visuais e de comprimento de arco ficam fora da validação espacial. Os quadros da trajetória seguem a curva sem correção de posição.
- A pose parte da transformação base. Quando orientada, um quaternion alinha o eixo +Z da pose base à tangente no sentido atual. Em seguida, a rotação automática é composta no eixo local. A derivada é analítica nas curvas paramétricas, e uma corda local aproxima a tangente nas splines. Quando a direção é indefinida, a orientação tangencial é omitida naquele quadro.
- O loop existente avança a fase local com delta limitado a 0,05 s. Pausar congela a fase e reiniciar volta ao início no sentido escolhido. Desativar volta à posição base e reinicia a fase da rotação própria, preservando sua configuração. A fase da trajetória congela durante o gizmo e é retomada após confirmação ou cancelamento. Uma prévia numérica usa fase local própria e mantém congelada a fase confirmada. Alterar o descritor ou hidratar um snapshot integral reinicia a trajetória. Atualizações de aparência, geometria ou transformação que preservam o descritor mantêm a fase local. Auxiliares de linha, pontos, extremos e direção ficam no cliente e são reconstruídos quando o percurso exibido muda.
- A versão 6 do protocolo adiciona o descritor opcional por objeto. Clientes com protocolo anterior poderiam omitir a trajetória numa atualização completa, por isso a sala exige a mesma versão. O servidor valida os descritores e rejeita alteração de trajetória em prévia colaborativa. A confirmação continua pelo fluxo de bloqueio e persistência existente. Fase, pausa, auxiliares e poses interpoladas ficam locais.
- A migration aditiva `20261127011417_AddEntityTrajectory` adiciona `RoomEntities.TrajectoryJson` como coluna anulável. Registros legados mantêm trajetória inativa. Para publicação futura, testar o [script idempotente SQL Server](sql/v2-10-add-entity-trajectory.sql) após a migration de partículas em base de teste, aplicar a coluna antes do backend, publicar o backend e o frontend em sequência e solicitar recarga dos clientes. Reverter a migration remove a coluna e seus descritores.

### Resultados e pendências

- [x] 54 testes JavaScript e 43 testes .NET aprovados. Build .NET sem avisos. Build Vite concluído com avisos de anotações do SignalR e de tamanho do bundle.
- [x] A suíte SQLite validou a migration sobre uma sala anterior, recuperação após reinício, validação espacial e ausência de gravação em prévias e confirmações redundantes. O modelo coincide com a última migration nos dois providers. O script SQL Server gerado foi conferido localmente.
- [x] Chrome headless com SwiftShader verificou os cinco percursos, duas projeções, rotação combinada com orientação tangencial, atualização do inspetor, auxiliares locais, chão receptor e partículas. Em duas sessões, uma sequência de ajustes de duração produziu uma confirmação durável. A reprodução e os controles locais não enviaram atualizações de objeto. Um arraste com eventos de ponteiro no eixo X do gizmo ortográfico atualizou a posição base na outra sessão e preservou a trajetória. Após reiniciar o backend, o descritor Catmull-Rom com cinco pontos foi recuperado de SQLite.
- [ ] Validar a interação por toque, medir desempenho com muitas trajetórias ativas em hardware real e aplicar o script somente em um SQL Server de teste antes da publicação.

## V2-11 — Modelagem por revolução e extrusão

### Implementação e decisões

- O catálogo compartilhado passa a oferecer 15 geometrias. A categoria Geometria usa um editor numérico com prévia SVG e seção de pontos recolhível. Os quatro perfis e os seis contornos predefinidos viram pontos editáveis quando aplicados. A malha de prévia é local, é reutilizada ao confirmar e é descartada ao cancelar ou substituir.
- A revolução usa `LatheGeometry` em torno de Y, de +Z em direção a +X para o ângulo positivo. O raio é medido a partir do eixo. A origem fica no eixo na altura média entre os extremos do perfil, inclusive em revoluções parciais. O perfil admite de 2 a 24 pontos, raios de 0 a 4 e alturas de −4 a 4 com intervalo mínimo de 0,01. Só as extremidades podem tocar o eixo. A revolução usa de 3 a 128 segmentos, início de 0° a 360° e percurso de 5° a 360°. No modo parcial, as faces do corte angular ficam abertas.
- A extrusão usa um polígono simples de 3 a 24 pontos no plano XY, com coordenadas de −4 a 4. A origem fica no centro da caixa do contorno e na metade da profundidade em Z. O contorno fecha automaticamente. O arredondamento opcional aproxima cada canto por uma quadrática com ponto de controle no vértice e extremos a 20% das arestas vizinhas. O SVG e o backend usam o mesmo polígono amostrado enviado ao `Shape`. O coração inicia arredondado. Usamos de 2 a 12 segmentos por canto, profundidade de 0,05 a 6, e de 1 a 32 camadas na profundidade.
- O contorno precisa ter área mínima de 0,005 e espaçamento mínimo entre vizinhos. Cruzamentos, contatos e sobreposições entre arestas são rejeitados. O chanfro usa de 1 a 6 segmentos, espessura de 0,01 a 0,5 e tamanho de 0,005 a 0,4. A caixa ganha até √2 vezes o tamanho no plano e a espessura em Z. Exigimos que arestas não adjacentes tenham folga superior a duas vezes o deslocamento máximo. Nos vértices, o seno do semiângulo limita a perturbação que permitiria sobrepor arestas adjacentes. Contornos estreitos ou muito subdivididos podem exigir tamanho menor ou chanfro desligado.
- Para revolução com N pontos e S segmentos, o orçamento usa (S+1)N vértices e 2S(N−1) triângulos. Na extrusão, com M pontos no contorno amostrado e L intervalos em Z incluindo o chanfro, o limite superior é 2(M−2)+2ML triângulos e três vezes esse total em vértices. Os dois lados rejeitam combinações acima de 8.192 vértices ou 8.192 triângulos antes da malha. O frontend confere novamente a contagem real. Os semieixos conservadores alimentam as regras espaciais e a validação de trajetórias existentes.
- O descritor reutiliza `GeometryParameters` como mapa numérico. Um contorno personalizado envia `pointCount` e ambos os campos `xN` e `yN` de cada ponto, em unidades de 0,0001. Em revolução esses campos representam raio e altura. A forma padrão pode omitir todo o conjunto de pontos. Os descritores cabem na coluna existente de 1.024 caracteres. A duplicação inclui o descritor. Aplicar as propriedades copiadas mantém a geometria do destinatário e reaplica as propriedades já cobertas nas etapas anteriores.
- O protocolo passa para 7 porque clientes anteriores desconhecem as duas novas geometrias. É uma publicação coordenada de backend e frontend, com recarga das sessões. Registros anteriores mantêm seus descritores e defaults. A reversão para um frontend antigo após criar uma das novas formas exige preservar uma cópia da sala e tratar os registros incompatíveis. O modelo de banco permanece o mesmo e esta etapa dispensa migration.

### Resultados e pendências

- [x] 60 testes JavaScript e 46 testes .NET aprovados. Build .NET sem avisos. Build Vite com avisos de anotações do SignalR e tamanho do bundle.
- [x] Os testes validaram os dez modelos no catálogo, os limites das duas malhas, a interação com trajetórias, a conservação das propriedades na edição, a confirmação e a recuperação em SQLite usando a coluna existente.
- [x] Chrome headless com WebGL e SwiftShader verificou os dez modelos, edição, inclusão e remoção de pontos, prévia SVG e 3D, revolução de 150°, chanfro, os três materiais, textura de madeira, chão receptor, projeções, gizmo por eventos de ponteiro, inspetor, trajetória e rotação. Em duas sessões, uma edição contínua produziu uma confirmação e o reinício recuperou os descritores de ambas as formas. O painel permaneceu dentro da viewport móvel de 390 px.
- [x] A cena de teste com duas malhas, textura, chão receptor, rotação e trajetória na extrusão com 24 pontos, 32 intervalos de profundidade e seis segmentos de chanfro registrou 6.468 vértices nessa malha e mediana de 45,0 ms entre 30 quadros, em SwiftShader. A medição cobre o cenário completo com renderização por software.
- [ ] Verificar a edição por toque e medir em GPU real com várias geometrias no orçamento máximo.

## V2-12 — Ambientes e demonstrações

### Implementação e decisões

- O catálogo compartilhado versão 1 define laboratório de geometrias, galeria de materiais e texturas, estúdio de iluminação, laboratório de movimento, fonte de partículas, oficina de modelagem e cena vazia. Todos usam descritores comuns. As miniaturas são desenhos SVG próprios embutidos. Enquadrar usa a câmera do participante e conserva sua projeção.
- Adicionar mantém os objetos, os efeitos e a iluminação atuais. Substituir exige confirmação e troca objetos, efeitos e configuração de ambiente. Cena vazia oferece somente substituição. O modo local valida os descritores e os orçamentos antes de preparar as malhas. Em caso de falha ao construir o lote, os recursos preparados são liberados e a seleção anterior é preservada.
- A sala aceita somente identificador de ambiente, modo, versão do catálogo e UUID de operação. O servidor resolve o catálogo de confiança, exige ingresso na sala e usa os validadores existentes. Valem os limites de 100 objetos, quatro efeitos e 12.000 partículas. O maior lote de catálogo tem 15 entidades. Adicionar mantém os bloqueios existentes e substituir é rejeitado enquanto houver bloqueio ativo, inclusive do próprio solicitante. A publicação das invocações da sala é serializada com ingresso, saída e expiração de bloqueios para evitar intercalar notificações antigas com a troca.
- Uma transação do EF confirma o lote e seu recibo. Após a confirmação, o servidor publica um único evento com o lote e as revisões de iluminação e partículas, sem criar nem excluir objetos individualmente pelo hub. Uma nova tentativa com o mesmo UUID confirmado dispensa gravação e publicação. Se o retorno da gravação for ambíguo, o serviço verifica o recibo e, quando a verificação também falha, retoma pelo mecanismo de reconciliação com um snapshot integral. Após perder a confirmação, o navegador oferece repetir o mesmo ambiente e modo com o UUID original.
- O protocolo passa para 8 porque o evento de lote precisa ser interpretado por todos os participantes. A migration aditiva `AddEnvironmentReceipts` cria somente a tabela de recibos. A tabela não vincula os objetos ao catálogo. Para futura publicação, validar o [script idempotente do SQL Server](sql/v2-12-add-environment-receipts.sql) em base de teste, aplicar a migration antes do backend e publicar o frontend junto ao backend compatível. Os recibos precisam permanecer disponíveis para garantir a deduplicação após reinício.

### Resultados e pendências

- [x] 63 testes JavaScript e 49 testes .NET aprovados. Build .NET sem avisos. Build Vite com avisos de anotações do SignalR e tamanho do bundle.
- [x] A suíte SQLite validou lote único, bloqueios, rejeição por orçamento, rollback, confirmação perdida, recuperação da composição e deduplicação após reiniciar. O SQL do SQL Server foi gerado localmente e o EF confirmou o modelo.
- [x] Chrome headless com WebGL e SwiftShader confirmou os sete ambientes, cancelamento, aplicação local e compartilhada, enquadramento com câmeras independentes, materiais e textura, luzes, movimento, partículas e edição compartilhada de um objeto do catálogo. Confirmou também a rejeição sob bloqueio, a viewport de 390 px, a reconexão do navegador após reiniciar o backend e a recuperação em SQLite. A contagem do renderer permaneceu em 14 geometrias antes e após três substituições da oficina. Esse contador registra recursos contabilizados pelo Three.js durante o teste.
- [ ] Executar a migration em um SQL Server de teste e medir carregamento e uso de recursos em GPU real. A serialização da sala segue a arquitetura atual de instância única.

## V2-13 — Shaders personalizados

### Implementação e decisões

- Gradiente, ondulação, quadriculado, Fresnel, lava e holograma usam `ShaderMaterial` com Vertex e Fragment Shaders próprios. Todos calculam a cor independentemente das luzes da cena. Basic, Phong e Standard continuam disponíveis, e suas propriedades de textura e iluminação são preservadas ao alternar o material.
- O painel Aparência mantém a cor do objeto como cor primária, revela apenas controles do efeito selecionado e oferece GLSL somente para consulta e cópia. Opacidade, faces e aramado continuam disponíveis. O holograma usa transparência com mistura normal. Materiais transparentes continuam com teste de profundidade e deixam de escrever profundidade.
- O catálogo JSON compartilhado permite somente IDs conhecidos e parâmetros contextuais. O descritor contém o ID e as alterações em relação aos valores padrão. Os limites incluem amplitude de 0 a 0,35 unidade, velocidade de 0 a 8 rad/s e expoente Fresnel de 0,5 a 12. A lava usa duas escalas de ruído de valor com custo fixo. UVs alimentam os padrões, enquanto o Fresnel usa a normal no espaço da câmera e a direção correspondente à projeção perspectiva ou ortográfica.
- O loop existente avança a fase local em radianos a partir do delta limitado. Cada objeto tem uniforms próprios. Ajustes de parâmetros reaproveitam o material e mudam valores dos uniforms. O Three.js pode gerar variantes à medida que mudam propriedades estruturais do material. A fase reinicia ao criar uma nova instância de material, mudar o preset ou reidratar o objeto. Prévia e cancelamento ficam no cliente e o final do gesto usa o fluxo de confirmação existente.
- Na ondulação, `y' = y + A·sin(f·(x + 0,65z) + fase)`, logo a caixa local conservadora aumenta em A somente no semieixo Y. A caixa expandida é escalada e rotacionada nas validações de base, edição, duplicação, cópia, geometria e trajetória. Havendo rotação própria, a esfera da caixa escalada protege todas as orientações. As regras de trajetória usam a mesma caixa ou esfera segundo a orientação, inclusive para a validação do servidor.
- Raycast, vértices, normais, caixa, esfera e auxiliares do inspetor continuam lendo a geometria original na CPU. A seleção nas regiões exclusivamente deslocadas pode falhar. O enquadramento usa a caixa com margem para a deformação e o culling da malha deformada é suspenso. Os efeitos não recebem sombras. A ondulação com amplitude positiva também suspende a projeção de sombra, pois a profundidade padrão lê a malha original. Os demais efeitos ainda podem projetar a sombra geométrica sólida. A transparência procedural não é recortada no mapa de sombra.
- O diagnóstico de compilação ou vínculo identifica o preset no programa GLSL e troca para Basic naquele navegador ao fim do quadro. A malha e o descritor confirmado ficam disponíveis. A coluna `MaterialSettings` comporta o descritor adicional e o EF não exige migration. O protocolo passa para 9 para impedir que versões sem suporte sobrescrevam o descritor. Backend e frontend devem ser publicados em conjunto e os participantes devem recarregar a sessão.

### Resultados e pendências

- [x] 69 testes JavaScript e 51 testes .NET aprovados. Build .NET sem avisos. Build Vite com avisos de anotações do SignalR e tamanho do bundle. Os testes incluem criação nas quinze geometrias, validação de descritores, uniforms sem alteração da versão do material, fase local, limites incluindo trajetória, duplicação, descarte e fallback.
- [x] SQLite verificou a persistência dos novos parâmetros na coluna existente, a leitura de objetos legados, nenhuma escrita na prévia e deduplicação da confirmação.
- [x] Chrome headless com WebGL e SwiftShader compilou e vinculou os seis programas sem falhas no percurso normal. Verificou esfera, revolução e extrusão, câmeras ortográfica e perspectiva, holograma com profundidade, gizmo por ponteiro, flags de sombra e culling, movimento combinado, inspetor, GLSL somente leitura e viewport de 390 px. Em duas sessões, o gesto de amplitude confirmou uma vez sem recompilar nem publicar quadros. O backend reiniciado recuperou os descritores e o navegador reconectou. Uma falha GLSL provocada na sessão de teste ativou Basic localmente.
- [x] No Chrome headless, três trocas entre Standard e Shader mantiveram a contagem de programas ativos dos presets em 3. Com três malhas usando shaders, chão receptor e câmera ortográfica, a mediana de 30 intervalos foi de 40,0 ms em SwiftShader. A amostra descreve a cena completa com renderização por software.
- [ ] Medir em GPU real e validar seleção por toque onde a ondulação se afasta da malha original.

## V2-14 — Modelos glTF e GLB

### Implementação e decisões

- A categoria Modelos 3D aceita GLB 2.0 e glTF 2.0 autocontido. No JSON, buffers e imagens precisam estar em Base64. São aceitas imagens PNG/JPEG incorporadas. Arquivos auxiliares, URLs, extensões, múltiplas cenas, primitivas fora do modo triângulos, animações, esqueletos e morph targets ficam fora do recorte. A rejeição identifica a presença de animação quando detectada. O escopo estático permite limitar toda a hierarquia durante a rotação e o movimento do grupo raiz.
- A validação lê de fato os cabeçalhos e o JSON. Confere a árvore, os produtos das transformações, os intervalos de buffers e acessores, os valores dos atributos, os índices e as dimensões de imagens antes de chamar o GLTFLoader. Somente URLs temporárias geradas a partir dos bytes validados entram no carregador. São revogadas em sucesso, falha ou cancelamento. A carga cancelada em andamento termina sem inserir entidade e libera resultados parciais. O acompanhamento de dependências do parser é testado com a versão instalada do Three.js.
- Limites por arquivo de 4 MiB e 512 KiB de JSON, até oito buffers incorporados, 64 nós, 24 definições de malha, 32 primitivas instanciadas, 24.000 vértices, 16.384 triângulos, 16 materiais e oito texturas. Cada textura tem até 1.024 px por lado e o conjunto tem até 2.097.152 pixels por modelo. A cena aceita até seis modelos, 60.000 vértices, 40.000 triângulos e 6.291.456 pixels somados conservadoramente por instância. Os orçamentos procedurais continuam independentes.
- Um grupo de normalização centraliza a caixa original e escala uniformemente seu maior eixo para duas unidades. Um grupo raiz separado recebe gizmos, escala, rotação automática e trajetórias. O limite estático é a caixa transformada da hierarquia. A rotação automática exige a esfera que envolve a caixa escalada, e as trajetórias reaproveitam a validação conservadora existente. A superfície selecionável vem das malhas internas. O inspetor agrega contagens, atributos, caixa, esfera e matrizes do grupo raiz. Auxiliares individuais por vértice ficam desabilitados para hierarquias.
- Materiais e imagens ficam na aparência original. Edição de geometria, material uniforme, shaders, edição de submalhas e cópia de propriedades ficam indisponíveis para modelos. Duplicatas compartilham os recursos gráficos e têm suas próprias transformações. Arquivos particulares liberam recursos após a última instância. O catálogo mantém um cache durante a sessão e o libera junto com a aplicação.
- A autoria e as fontes dos três exemplos próprios, Farol modular, Pórtico de blocos e Satélite de laboratório, estão em [modelos-3d.md](modelos-3d.md). Os arquivos e o gerador são CC0 1.0. Os exemplos não dependem de texturas externas.
- Particulares são excluídos dos snapshots e das mutações SignalR. Ao entrar na sala, ficam reservados na memória do navegador, fora da cena compartilhada. Voltam no modo local quando o orçamento permite, com opção de restaurar depois se necessário. Depois de recarregar a página, é preciso importar os arquivos particulares novamente.
- O protocolo passa para 10. Para modelos de catálogo, o tipo da entidade identifica um ativo conhecido e mantém os descritores convencionais de transformação e trajetória. Nenhum arquivo, referência remota, material interno ou binário é enviado pelo hub ou armazenado no SQL. O servidor valida catálogo, limites, orçamento e preservação da aparência original. As colunas existentes atendem a etapa. Clientes antigos precisam atualizar junto com o backend antes de usar os novos tipos.

### Resultados e pendências

- [x] 75 testes JavaScript e 53 testes .NET aprovados. Build .NET sem avisos. A suíte cobre GLB e glTF autocontido, catálogo, limites, seleção em hierarquia, privacidade, descarte, duplicação, inspetor e ambientes. O SQLite confirmou hidratação e persistência apenas pelo tipo do catálogo.
- [x] O build Vite manteve os avisos de anotações do SignalR e tamanho do bundle. O JavaScript principal passou de 749,67 kB para 808,42 kB. O GLTFLoader ficou num chunk de 44,80 kB, ou 13,22 kB em gzip, carregado sob demanda na importação ou preparação da sala colaborativa.
- [x] Chrome headless com WebGL e SwiftShader confirmou GLB, glTF com PNG embutido, os três exemplos, seleção por raycast em uma submalha, arraste real pelo gizmo, inspeção, câmeras ortográfica e perspectiva, projeção de sombra e movimentação por rotação e trajetória. Arquivos inválidos, externos e acima do limite foram recusados. A área móvel de 390 px manteve o painel no viewport.
- [x] Duas sessões confirmaram a exclusão de particulares do ingresso, restauração ao voltar ao modo local, atualização do grupo raiz do modelo compartilhado e reconexão após reinício com os três modelos em SQLite. O renderer voltou de 3 a 3 geometrias após três ciclos de importação e exclusão. Com três modelos e o cubo inicial, a amostra de 30 intervalos teve mediana de 45,0 ms em SwiftShader. O tempo descreve a cena completa em renderização por software.
- [ ] Medir em GPU real, validar entrada por toque e revisar os formatos recusados durante a demonstração, sobretudo exportações que usam extensões ou recursos separados.

## V2-15B.1 — Correção do E-01

- A fila capturava o objeto inteiro antes do bloqueio e o servidor substituía o descritor confirmado mesmo quando o bloqueio era adquirido depois de outra edição. O filtro de eco próprio comparava a mensagem com o envio em curso e ignorava o fato de que a cena local tinha mudado nesse intervalo. O teste determinístico da posição confirmada falhou no protocolo anterior, com X=0 em vez de X=2.
- O protocolo 11 troca o argumento do hub por `EntityEditDto` com `before`, `after` e `final`. A base vem do estado autorado antes do gesto ou antes da mutação, sem ler a pose visual. Sob o bloqueio, o servidor identifica e compara grupos de domínio. Nome, tipo e parâmetros geométricos formam um grupo. Material, textura e shader formam outro. Posição, rotação, escala, cor, modo de exibição, rotação automática e trajetória são grupos próprios. Grupos intocados conservam o estado atual. Um grupo já igual ao resultado solicitado permite reenvio sem nova gravação. Se o grupo mudou para outro valor, a edição é rejeitada. O servidor valida integralmente a composição antes de confirmá-la, inclusive limites espaciais, trajetória, materiais e modelos de catálogo.
- Prévias de gizmo passam por `EntityPreviewed` e alteram somente a pose exibida. Confirmações passam pelo evento ordenado `EntityUpserted`, inclusive para o autor. A invocação apenas indica aceitação ou rejeição. Assim, a resposta não reaplica snapshots sobre eventos posteriores. O cliente conserva a intenção de cada gesto e reexibe gestos posteriores apenas quando sua base integral ainda corresponde à projeção local. Remover um objeto ou substituir a sala impede o reenvio de recriá-lo.
- A persistência e os recibos de ambientes usam o schema atual. Não foi necessária migration. A deduplicação da edição usa os valores confirmados dos grupos, sem revisão persistida por entidade. A ordenação dos eventos usa a instância única e a conexão SignalR atual. As intenções pendentes ficam em memória na página. Após uma confirmação ambígua há tentativas limitadas, e a reconexão também reavalia as pendências. A recuperação geral do ingresso transitório foi deixada para E-02.
- Passaram 81 testes JavaScript e 57 testes .NET. Os novos testes cobrem a aquisição controlada do bloqueio, conexão trocada, prévia descartada, autoria da base, gestos pendentes, conflitos por grupo e por composição, confirmação ambígua, reenvio sem escrita e substituição de ambiente. Os dois builds passaram, com os avisos já conhecidos do Vite.
- Em duas sessões Chrome headless com SignalR e SQLite temporário, a cor vermelha `#f06b6b` e X=2 coincidiram nos dois navegadores, no snapshot, na linha consultada diretamente em SQLite e após reiniciar o backend. A confirmou a cor uma única vez. No conflito de cor, permaneceu o verde confirmado por B. No conflito de largura com escala e trajetória, o servidor preservou a escala X=3, a trajetória e a geometria confirmadas e informou a violação dos limites a A.
