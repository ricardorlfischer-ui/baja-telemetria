/* Registro único das páginas (docs/ARQUITETURA.md 4.2): rota, rótulo, ícone, grupo do menu,
 * se precisa de sessão aberta e o componente (carregado sob demanda).
 * A barra lateral, o roteador e os títulos saem daqui. Página nova = uma linha aqui. */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  IconActivity, IconCar, IconCarSuspension, IconChartDots, IconChartLine, IconCpu,
  IconFileDescription, IconFolder, IconGitCompare, IconGauge, IconLayoutDashboard, IconLogin, IconMap2,
  IconRoute, IconSettings, IconTemperature, IconTool, IconUsers, IconWaveSine, IconFlag, type Icon,
} from '@tabler/icons-react';

export type NavGroup = 'Dados' | 'Sessão' | 'Engenharia' | 'Projeto' | 'Configuração';
export const NAV_GROUPS: NavGroup[] = ['Dados', 'Sessão', 'Engenharia', 'Projeto', 'Configuração'];

export interface AppRoute {
  /** caminho do HashRouter (#/canais) */
  path: string;
  label: string;
  icon: Icon;
  /** grupo do menu; null = fora do menu (login, desenvolvimento) */
  group: NavGroup | null;
  /** desabilitada (com dica) sem uma sessão aberta */
  needsSession: boolean;
  /** só existe com o servidor da equipe */
  serverOnly?: boolean;
  /** mostra a barra de reprodução no rodapé */
  player?: boolean;
  /** a frase do que a página responde para o projeto (subtítulo do PageHeader) */
  question: string;
  component: LazyExoticComponent<ComponentType>;
}

export const ROUTES: AppRoute[] = [
  /* Dados */
  {
    path: '/', label: 'Sessões', icon: IconFolder, group: 'Dados', needsSession: false,
    question: 'Todos os logs da equipe num lugar só: envie, filtre por pista, carro e piloto, e abra para analisar.',
    component: lazy(() => import('./pages/SessoesPage')),
  },
  {
    path: '/aquisicao', label: 'Aquisição', icon: IconCpu, group: 'Dados', needsSession: false,
    question: 'Quais sensores este log tem, se os dados prestam e o que cada sensor permite decidir no projeto do carro.',
    component: lazy(() => import('./pages/AquisicaoPage')),
  },
  /* Sessão */
  {
    path: '/sessao', label: 'Visão geral', icon: IconLayoutDashboard, group: 'Sessão', needsSession: true, player: true,
    question: 'O resumo do teste: os números que importam para o projeto e os pontos de atenção.',
    component: lazy(() => import('./pages/VisaoGeralPage')),
  },
  {
    path: '/canais', label: 'Canais', icon: IconChartLine, group: 'Sessão', needsSession: true, player: true,
    question: 'Cada canal ao longo do tempo ou da distância, empilhados e sincronizados, para achar o que aconteceu e onde.',
    component: lazy(() => import('./pages/CanaisPage')),
  },
  {
    path: '/mapa', label: 'Mapa', icon: IconMap2, group: 'Sessão', needsSession: true, player: true,
    question: 'Onde na pista cada coisa acontece: a trajetória colorida por qualquer canal.',
    component: lazy(() => import('./pages/MapaPage')),
  },
  {
    path: '/voltas', label: 'Voltas', icon: IconFlag, group: 'Sessão', needsSession: true, player: true,
    question: 'Quanto tempo cada volta levou e em que trechos o carro ganhou ou perdeu tempo.',
    component: lazy(() => import('./pages/VoltasPage')),
  },
  {
    path: '/dispersao', label: 'Dispersão', icon: IconChartDots, group: 'Sessão', needsSession: true,
    question: 'Como um canal varia com outro: correlações entre sensores para entender o carro.',
    component: lazy(() => import('./pages/DispersaoPage')),
  },
  /* Engenharia */
  {
    path: '/suspensao', label: 'Suspensão', icon: IconCarSuspension, group: 'Engenharia', needsSession: true,
    question: 'Quanto curso cada canto usa, a que velocidade o amortecedor trabalha e se a suspensão bate no fim de curso.',
    component: lazy(() => import('./pages/SuspensaoPage')),
  },
  {
    path: '/ressonancia', label: 'Ressonância', icon: IconWaveSine, group: 'Engenharia', needsSession: true,
    question: 'A frequência natural e o amortecimento da carroceria, e se a pista excita a ressonância.',
    component: lazy(() => import('./pages/RessonanciaPage')),
  },
  {
    path: '/trem-de-forca', label: 'Trem de força', icon: IconGauge, group: 'Engenharia', needsSession: true,
    question: 'Potência que chega na roda, desempenho nas largadas e as resistências ao movimento (coast-down).',
    component: lazy(() => import('./pages/TremDeForcaPage')),
  },
  {
    path: '/cvt', label: 'CVT', icon: IconTemperature, group: 'Engenharia', needsSession: true,
    question: 'Quanto a CVT esquenta e se ela aguenta o enduro inteiro com a ventilação atual.',
    component: lazy(() => import('./pages/CvtPage')),
  },
  {
    path: '/dinamica', label: 'Dinâmica', icon: IconActivity, group: 'Engenharia', needsSession: true,
    question: 'Quanta aceleração o carro usa em curva, frenagem e tração, e em que velocidades passa o tempo.',
    component: lazy(() => import('./pages/DinamicaPage')),
  },
  /* Projeto */
  {
    path: '/projeto', label: 'Ficha do carro', icon: IconFileDescription, group: 'Projeto', needsSession: true,
    question: 'Os números de projeto do carro do ano que vem, cada um com os sensores de onde saiu.',
    component: lazy(() => import('./pages/ProjetoPage')),
  },
  {
    path: '/comparar', label: 'Comparar sessões', icon: IconGitCompare, group: 'Projeto', needsSession: false,
    question: 'O que mudou entre testes, setups e pilotos: métricas lado a lado e ao longo das datas.',
    component: lazy(() => import('./pages/CompararPage')),
  },
  /* Configuração */
  {
    path: '/carro', label: 'Carro', icon: IconCar, group: 'Configuração', needsSession: false,
    question: 'As medidas do carro que entram nas contas: massa, geometria, suspensão, roda, CVT e resistências.',
    component: lazy(() => import('./pages/CarroPage')),
  },
  {
    path: '/pista', label: 'Pista e GPS', icon: IconRoute, group: 'Configuração', needsSession: false,
    question: 'Onde fica a pista e como o GPS chega no log (track_config.h, canais X/Y, linha de largada).',
    component: lazy(() => import('./pages/PistaPage')),
  },
  {
    path: '/equipe', label: 'Equipe', icon: IconUsers, group: 'Configuração', needsSession: false, serverOnly: true,
    question: 'Quem acessa a biblioteca da equipe: usuários, convites e papéis.',
    component: lazy(() => import('./pages/EquipePage')),
  },
  {
    path: '/config', label: 'Preferências', icon: IconSettings, group: 'Configuração', needsSession: false,
    question: 'Tema, endereço do servidor da equipe e conta.',
    component: lazy(() => import('./pages/PreferenciasPage')),
  },
  /* fora do menu */
  {
    path: '/login', label: 'Entrar', icon: IconLogin, group: null, needsSession: false,
    question: 'Entre no servidor da equipe para ver e enviar as sessões compartilhadas.',
    component: lazy(() => import('./pages/LoginPage')),
  },
  {
    path: '/dev/componentes', label: 'Componentes', icon: IconTool, group: null, needsSession: false,
    question: 'Vitrine dos componentes de gráfico e layout, para conferir o visual nos dois temas.',
    component: lazy(() => import('./pages/DevComponentesPage')),
  },
];

/** Rota pelo caminho (ex.: para o título da página). */
export const routeByPath = (path: string): AppRoute | undefined => ROUTES.find(r => r.path === path);

