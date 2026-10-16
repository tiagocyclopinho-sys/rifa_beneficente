# Rifa Beneficente — Guia de uso

## O que é

| Parte | Endereço | Quem usa |
|---|---|---|
| Site do comprador | `/` (index.html) | Público: escolhe números, paga no Pix |
| Painel admin | `/admin` (admin.html) | Você: confere Pix, lança vendas, faz o sorteio |
| Banco de dados | Supabase (`database/schema.sql`) | Guarda tudo e aplica as regras |

## Como funciona o dia a dia

```
Comprador escolhe números ──► números ficam RESERVADOS (30 min)
        │
        ▼
Paga o Pix (QR Code / Copia e Cola, valor já preenchido)
        │
        ▼
Toca "Já paguei" ──► abre seu WhatsApp com pedido + números
        │              e o pedido vai para "Conferir" no painel
        ▼
Você abre o app do banco, vê o Pix, clica ✔ Confirmar
        │
        ▼
Números ficam VENDIDOS no site ──► botão WhatsApp avisa o comprador
```

- **Não pagou em 30 min?** Os números voltam sozinhos para venda.
- **Pagou depois de expirar?** Você ainda pode confirmar no painel (filtro "Cancelados / expirados"), se os números estiverem livres.
- **Pagou em dinheiro?** Aba **Venda manual**: nome, WhatsApp e números (ex.: `7, 15, 100-105`).

### Por que a confirmação é manual (por enquanto)
Nubank e Neon **não oferecem API Pix** para pessoa física avisar o sistema quando o dinheiro cai.
O Pix gerado pelo site é o padrão oficial do Banco Central e cai direto na sua chave, sem taxa.
Você só precisa conferir no extrato e clicar em Confirmar. O código do pedido vai no Pix (campo identificador)
e na mensagem do WhatsApp. Para confirmar sozinho no futuro, dá para trocar por Mercado Pago (taxa ~0,99%).

## Sorteio (Loteria Federal)

1. O botão só libera com **80% dos números pagos** (400 de 500) e **sem reservas pendentes**.
2. Após a extração da Federal, pegue em **loterias.caixa.gov.br → Federal** o concurso e os 5 prêmios.
3. Na aba **Sorteio**, digite tudo. O painel mostra a **prévia** do ganhador antes de gravar.
4. Clique **Registrar resultado oficial** (definitivo). O site passa a mostrar o número ganhador,
   o primeiro nome e o final do telefone (sem expor dados completos).

**Regra (aparece no regulamento do site):**
- 3 últimos dígitos do 1º prêmio. 001–500 = ele mesmo. 501–999 = menos 500 (734 → 234). 000 = 500.
- Número não vendido → tenta 2º, 3º, 4º e 5º prêmios.
- Nenhum vendido → o próximo número vendido acima do obtido no 1º prêmio.

## Colocar no ar (uma vez)

1. **Supabase**: criar um projeto novo → *SQL Editor* → colar e rodar `database/schema.sql`.
2. No SQL Editor: `insert into rifa_admins (email) values ('seu-email@...');`
3. *Authentication → Users → Add user*: mesmo e-mail + senha (marque "Auto confirm").
4. *Authentication → Sign In / Providers*: desligar **"Allow new users to sign up"**.
5. *Project Settings → API*: copiar **URL** e **publishable key** para `js/config.js`.
6. **Vercel**: publicar a pasta `rifa-beneficente` (site estático, sem build).
7. Entrar em `/admin` → **Configurações**: título, prêmio, chave Pix, nome e cidade do recebedor,
   WhatsApp que recebe comprovantes, data do sorteio. Use **"Gerar Pix de teste (R$ 0,01)"** e pague
   pelo seu banco para confirmar que a chave está certa.
8. Fazer uma compra de teste no site, confirmar no painel e depois cancelar.

> ⚠️ Use a sua **conta pessoal** no Supabase e na Vercel, não as contas da empresa (JR Oper).
> Os dois têm plano gratuito, suficiente para a rifa.

## Segurança
- O público não lê nenhuma tabela: só vê quais números estão livres/reservados/vendidos.
- Nome e WhatsApp dos compradores só aparecem no painel admin, com login.
- Dois compradores nunca levam o mesmo número (trava no banco).
- Limites anti-abuso: até 50 números por pedido e 3 pedidos pendentes por WhatsApp (ajustável).

## Aviso legal
Rifas no Brasil dependem de autorização (Lei 5.768/71, hoje pela Secretaria de Prêmios e Apostas do
Ministério da Fazenda). Para divulgação aberta, procure a autorização pela entidade beneficiada ou
mantenha a divulgação restrita ao seu círculo ("ação entre amigos").
