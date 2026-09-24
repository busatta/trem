# 🚂 Trenzinho

Jogo de trem em 3D para crianças pequenas, feito para tablet (funciona em qualquer navegador moderno).

A criança escolhe um de três trens e passeia por um mundinho com fazenda, cidade, túnel, ponte, rio e vaquinhas:

| Trem | Para andar | Botão especial |
|---|---|---|
| **Maria Fumaça** | colocar **carvão** (a fornalha acende e sai fumaça) | pá de carvão |
| **Trem Elétrico** | levantar o **pantógrafo** até o fio (sai faísca!); com ele no fio, a bateria carrega | ⚡ |
| **Trem a Diesel** | abastecer com **diesel** (o motor liga com fumaça preta) | ⛽ |

## Como brincar

- **Botão verde grande** ▶: anda. Com o trem andando ele fica vermelho ⏹ e serve para parar.
- 📯 **Buzina**: cada trem tem a sua (a Maria Fumaça faz "piuí!"). Tocar no trem também buzina.
- 🎵 **Música do trem elétrico**: cada buzinada toca a próxima nota de *Brilha, Brilha, Estrelinha*. Apertando várias vezes, a criança "toca" a música inteira.
  Cada nota gasta um pouquinho da bateria; quando acaba, é só levantar o pantógrafo ⚡ para recarregar. Se ficar um tempo sem tocar, a música recomeça do início.
- 💡 **Luz da cabine**: acende e apaga a luz dentro da cabine (as janelas também acendem, bonito de ver à noite).
- 🐂 **O touro bravo!** Depois de **30 buzinadas**, um touro vem correndo atrás do trem, com uma musiquinha de tensão.
  Aparece um botão laranja **💨 Corre!**: quanto mais rápido a criança aperta, mais rápido o trem foge. Em cima aparece o touro chegando perto do trem.
  Aguentando 12 segundos sem ser pego, o trem escapa e ganha **3 estrelas** ⭐. Se o touro pegar, perde **3 estrelas** e o trem para.
  (Apertando umas 2 vezes por segundo já dá para escapar. As regras ficam no começo de `js/chase.js`, fáceis de mudar.)
- 🐢 / 🐇: devagar ou rápido.
- 🎥 **Câmera**: troca a visão: 😊 de frente (com o rostinho do trem), 🚂 de trás, 👀 **dentro da cabine**, 🌳 da beira do trilho e ☁️ lá do alto.
  Arrastar o dedo na tela gira a câmera (na cabine, dá para olhar para os lados).
  Ao chegar numa estação com a câmera dentro da cabine, ela vai sozinha para fora para mostrar a carga, e volta para a cabine quando o trem parte.
- **Estações**: na **Fazenda** o trem para sozinho e aparece o botão amarelo **Carregar** (presentes, madeira, maçãs, bolas, leite...).
  Na **Cidade** aparece **Descarregar**. Cada entrega vale uma ⭐.
- 🌙 / ☀️: noite e dia (à noite o farol do trem acende, e as janelas e estrelas também).
- Tocar nas **vaquinhas** faz "muuu" 🐄.
- 🏠 volta para a escolha do trem.

Uma voz em português (a do próprio tablet) vai dando dicas: "Precisa de carvão!", "Chegamos na fazenda!", etc.
Os botões que a criança precisa apertar ficam **pulsando**, então dá para brincar sem saber ler.

## Como colocar no seu servidor

Não precisa instalar nada nem compilar. São só arquivos estáticos:

```
index.html
style.css
manifest.webmanifest
icon.svg
js/        (código do jogo)
vendor/    (biblioteca Three.js, já incluída, funciona sem internet)
```

1. Copie a pasta inteira para o seu servidor (por exemplo `/var/www/html/trem/`).
2. Abra `https://seu-site/trem/` no tablet.

> ⚠️ Precisa ser aberto por um servidor web (http/https). Abrir o `index.html` direto do disco (`file://`) não funciona, porque o navegador bloqueia os módulos JavaScript.

Para testar no computador:

```bash
python3 -m http.server 8000
# e abra http://localhost:8000
```

### Dicas para o tablet

- **Adicione à tela inicial** ("Adicionar à tela de início" no Safari/Chrome): o jogo abre em tela cheia, como um app.
- Deixe o tablet **deitado** (paisagem).
- Se a voz não falar, confira se há uma voz em português instalada no aparelho (Configurações → Acessibilidade / Texto para fala).
- O botão 🔊 desliga todos os sons e a voz.

## Detalhes técnicos

- 3D com [Three.js](https://threejs.org) r170 (em `vendor/`).
- Todos os sons são sintetizados com Web Audio (sem arquivos de áudio).
- As estrelas ganhas ficam salvas no próprio navegador (localStorage).
- Código:
  - `js/main.js`: regras do jogo, câmeras, botões
  - `js/world.js`: trilho, terreno, estações, túnel, ponte, fazenda, cidade
  - `js/trains.js`: modelos 3D dos trens e vagões
  - `js/audio.js`: sons e voz
  - `js/chase.js`: a perseguição do touro
