/* Identidade da equipe: nome, logo (foto do carro em recorte redondo) e a faixa com a foto
 * inteira. As cores da pintura (preto com faixas amarela, laranja e vermelha) viram o
 * laranja do tema (theme.ts) e a faixa colorida do cabeçalho (global.css, --bt-stripe). */
import type { ReactNode } from 'react';
import logoUrl from './assets/brand/logo.webp';
import photoUrl from './assets/brand/baja-maua.webp';

export const TEAM_NAME = 'Mauá Racing Baja';
export const APP_NAME = 'Telemetria';
export const FULL_NAME = `${TEAM_NAME} · ${APP_NAME}`;

/** Logo redondo (foto do carro) com o anel nas cores da pintura. */
export function BrandLogo({ size = 34 }: { size?: number }) {
  return (
    <span className="bt-logo" style={{ width: size, height: size }} aria-hidden>
      <img src={logoUrl} alt="" width={size} height={size} draggable={false} />
    </span>
  );
}

interface BrandHeroProps {
  title?: ReactNode;          /* padrão: nome da equipe */
  subtitle?: ReactNode;       /* padrão: o que o app faz */
  children?: ReactNode;       /* botões / conteúdo por cima da foto */
  compact?: boolean;          /* faixa baixa (topo de páginas); sem = alta (login) */
}

/** Faixa com a foto do carro, o nome da equipe e um degradê para o texto ficar legível. */
export function BrandHero({ title = TEAM_NAME, subtitle, children, compact }: BrandHeroProps) {
  return (
    <section className={`bt-hero${compact ? ' bt-hero--compact' : ''}`}>
      <img className="bt-hero-img" src={photoUrl} alt="Carro da Mauá Racing Baja em curva, com o piloto inclinado e a roda dianteira no ar" />
      <div className="bt-hero-shade" aria-hidden />
      <div className="bt-hero-body">
        <div className="bt-hero-kicker">{APP_NAME}</div>
        <h1 className="bt-hero-title">{title}</h1>
        {subtitle !== undefined
          ? <p className="bt-hero-sub">{subtitle}</p>
          : <p className="bt-hero-sub">Dados do carro em gráficos e números para projetar o carro do ano que vem.</p>}
        {children && <div className="bt-hero-actions">{children}</div>}
      </div>
      <div className="bt-stripe" aria-hidden />
    </section>
  );
}
