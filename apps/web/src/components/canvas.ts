/* Utilidades de canvas compartilhadas pelo XYPlot e pelo TrackMap. */
import { useLayoutEffect, useState, type RefObject } from 'react';

/** Canvas nítido em telas HiDPI (BT.setupCanvas). Retorna [ctx, largura, altura] em px CSS. */
export function setupCanvas(c: HTMLCanvasElement, w?: number, h?: number): [CanvasRenderingContext2D, number, number] {
  const d = window.devicePixelRatio || 1;
  w = w ?? c.clientWidth; h = h ?? c.clientHeight;
  if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
    c.width = Math.round(w * d); c.height = Math.round(h * d);
  }
  const g = c.getContext('2d')!;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
}

/** Tamanho do elemento (ResizeObserver). Começa em 0×0 até a primeira medida. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize(s => (Math.abs(s.width - r.width) > 0.5 || Math.abs(s.height - r.height) > 0.5 ? { width: r.width, height: r.height } : s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
