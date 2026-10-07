"""Gera scripts/windows/telemetria.ico (ícone do atalho "Telemetria · Mauá Racing Baja").

A foto do carro (apps/web/src/assets/brand/logo.webp) recortada em círculo, fundo
transparente, com um anel fino nas cores da pintura: amarelo por dentro, laranja no meio e
vermelho por fora, como as faixas do carro. Tamanhos 16, 24, 32, 48, 64, 128 e 256 px.

Desenha em 1024 px e reduz (bordas suaves). Nos tamanhos pequenos (até 32 px) o recorte é
mais fechado no carro, senão a foto vira borrão. Só precisa do Pillow:

    python scripts/windows/gerar-icone.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
ORIGEM = RAIZ / 'apps' / 'web' / 'src' / 'assets' / 'brand' / 'logo.webp'
DESTINO = AQUI / 'telemetria.ico'

AMARELO = (0xF5, 0xB5, 0x1B, 255)
LARANJA = (0xEF, 0x7D, 0x22, 255)
VERMELHO = (0xD2, 0x3C, 0x2A, 255)

GRANDE = 1024        # desenho em alta, depois reduz
TAMANHOS = [16, 24, 32, 48, 64, 128, 256]


def desenha(foto: Image.Image, recorte: tuple[int, int, int, int], anel: float) -> Image.Image:
    """Ícone em GRANDE x GRANDE: foto no círculo + anel de três faixas.
    anel = espessura total do anel em fração do raio."""
    img = Image.new('RGBA', (GRANDE, GRANDE), (0, 0, 0, 0))
    r = GRANDE / 2
    larg = r * anel                     # espessura total do anel
    faixa = larg / 3                    # cada cor

    # foto, recortada no círculo de dentro do anel
    dentro = round(GRANDE - 2 * larg) + 2
    f = foto.crop(recorte).resize((dentro, dentro), Image.LANCZOS).convert('RGBA')
    masc = Image.new('L', (dentro, dentro), 0)
    ImageDraw.Draw(masc).ellipse((0, 0, dentro - 1, dentro - 1), fill=255)
    pos = round(larg) - 1
    img.paste(f, (pos, pos), masc)

    # anel: vermelho por fora, laranja, amarelo por dentro
    d = ImageDraw.Draw(img)
    for i, cor in enumerate((VERMELHO, LARANJA, AMARELO)):
        a = i * faixa
        d.ellipse((a, a, GRANDE - 1 - a, GRANDE - 1 - a), outline=cor, width=max(1, round(faixa)))
    return img


def main() -> None:
    foto = Image.open(ORIGEM).convert('RGB')
    w, h = foto.size
    lado = min(w, h)
    cheio = ((w - lado) // 2, (h - lado) // 2, (w - lado) // 2 + lado, (h - lado) // 2 + lado)
    # o carro fica no meio-direita da foto: recorte fechado nele para os ícones pequenos
    fechado = (int(w * 0.16), int(h * 0.12), int(w * 0.94), int(h * 0.90))

    grande = desenha(foto, cheio, anel=0.075)
    pequeno = desenha(foto, fechado, anel=0.16)   # anel mais grosso para aparecer em 16 px

    imagens = []
    for t in TAMANHOS:
        base = pequeno if t <= 32 else grande
        imagens.append(base.resize((t, t), Image.LANCZOS))

    # o .ico guarda cada tamanho desenhado (não só o maior reduzido pelo Windows)
    imagens[-1].save(DESTINO, format='ICO', sizes=[(t, t) for t in TAMANHOS],
                     append_images=imagens[:-1])
    print(f'{DESTINO} ({", ".join(str(t) for t in TAMANHOS)} px)')


if __name__ == '__main__':
    main()
