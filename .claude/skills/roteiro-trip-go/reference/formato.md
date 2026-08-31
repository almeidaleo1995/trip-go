# Formato do JSON de importação

O contrato executável é `lib/schema.ts`. Em qualquer divergência, **o schema vence este documento** — ele é validado por testes, isto aqui é explicação.

Toda lista é opcional. Uma viagem só com `viagem` e `roteiro` é válida; as abas sem dado mostram estado vazio.

```jsonc
{
  "schemaVersion": 3,

  "viagem": {
    "nome": "Europa 2027",
    "subtitulo": "5 pessoas · 7 países · 17 dias",   // opcional
    "data_partida": "2026-12-30",                     // AAAA-MM-DD, sem hora
    "data_retorno": "2027-01-15",
    "moeda": "EUR",                                   // 3 letras; padrão EUR
    "fuso": "Europe/Madrid",                          // fuso IANA do destino; null = relógio do aparelho
    "cor_destaque": "#0F766E"                         // hex de 6 dígitos
  },

  "participantes": [
    {
      "nome": "Leonardo Almeida",   // exatamente como está no passaporte
      "email": "leo@exemplo.com",   // vincula a conta; a pessoa se cadastra sozinha
      "papel": "proprietario",      // "proprietario" | "editor" | "visualizador"
      "telefone": "+55 47 90000-0000",
      "passaporte": null, "documento": null, "nascimento": null,
      "ordem": 0
    }
  ],

  "roteiro": [
    {
      "ocorre_em": "2026-12-30T10:30",  // hora LOCAL DO DESTINO. sem Z, sem offset
      "fim_em": "2026-12-30T13:00",     // sem ele a aba HOJE não conta quanto falta
      "titulo": "LA719 Florianópolis → Santiago",
      "cidade": "Florianópolis",
      "local": "Aeroporto Hercílio Luz",
      "endereco": "Rod. Ac. Norte, 4204, 88047-902 Florianópolis",  // vira a tela do motorista
      "lat": -27.6705, "lon": -48.5477,  // só se o documento trouxer; NUNCA inventar
      "descricao": "Check-in internacional pede 3h.",
      "tipo": "voo",       // voo|hospedagem|cruzeiro|passeio|traslado|documento|refeicao
      // O DESLOCAMENTO ATÉ AQUI (não a partir daqui). É o que calcula "saia às".
      "distancia_m": 950, "duracao_min": 14, "transporte": "a_pe",
      "ancora": true       // só no que não pode ser perdido
    }
  ],

  "voos": [
    {
      "companhia": "LATAM",
      "numero": "LA719",
      "origem_iata": "FLN",   "origem_cidade": "Florianópolis",
      "destino_iata": "MAD",  "destino_cidade": "Madri",
      "parte_em": "2026-12-30T10:30",
      "chega_em": "2026-12-31T17:30",   // horário local de cada ponta
      "duracao_min": 1860,
      "localizador": "WSZIAK",
      "escalas": [
        { "iata": "SCL", "cidade": "Santiago", "espera_min": 640, "ordem": 0 }
      ]
    }
  ],

  "cruzeiros": [
    {
      "navio": "MSC Preziosa",
      "companhia": "MSC Cruzeiros",
      "embarque_em": "2027-01-03T20:00",
      "desembarque_em": "2027-01-10T07:00",
      "porto_embarque": "Hamburgo",
      "porto_desembarque": "Hamburgo",
      "cabine": null,        // ausente é melhor que inventado
      "terminal": null,      // "só o seu voucher sabe"
      "portos": [
        { "porto": "Zeebrugge", "cidade": "Bruges", "pais": "Bélgica",
          "chega_em": "2027-01-05T07:00", "sai_em": "2027-01-05T18:00", "ordem": 1 },
        { "dia_no_mar": true, "ordem": 0, "nota": "Mar do Norte" }  // sem porto
      ]
    }
  ],

  "reservas": [
    { "tipo": "hospedagem",   // hospedagem|restaurante|passeio|ingresso|carro|transporte|outro
      "nome": "Hotel em Madri", "cidade": "Madri",
      "inicio_em": "2026-12-31T15:00", "fim_em": "2027-01-01T11:00",  // noites são calculadas
      // endereço e telefone alimentam "Onde eu durmo hoje": sem eles o cartão
      // aparece sem os botões de virar o celular e de ligar.
      "endereco": "Calle Atocha, 36, 28012 Madrid",
      "telefone": "+34 91 369 71 71",
      "link": null, "localizador": null }
  ],

  "lugares": [
    { "cidade": "Hamburgo", "pais": "Alemanha", "dias": 2,
      "lat": 53.5511, "lon": 9.9937,    // sem isso, não entra no mapa
      "notas": "Miniatur Wunderland abre todo dia do ano.", "ordem": 3 }
  ],

  "checklist": [
    { "titulo": "Solicitar os 5 ETAs do Reino Unido",
      "categoria": "Documentos",
      "escopo": "global",              // "global" (da viagem) | "pessoal" (por pessoa)
      "prazo_ideal": "2026-09-30",     // as duas datas dos PDFs de prazo
      "prazo_maximo": "2026-12-15",
      "valor_estimado_centavos": 55000,
      "detalhe": "Só no site gov.uk. Morre junto se o passaporte for renovado.",
      "prioridade": "obrigatorio",     // obrigatorio|importante|recomendado|opcional
      "assigned_to_nomes": [],         // nomes de participante; vazio = todos
      "pais": "Reino Unido", "cidade": null,
      "fonte_tipo": "documento",       // documento|pesquisa|sugestao|manual
      "fonte_detalhe": "Caderno de viagem, pág. 12", "fonte_consultado_em": "2026-08-24",
      "ordem": 0 }
  ],

  "documentos": [
    { "titulo": "Localizador LATAM", "valor": "WSZIAK", "tipo": "texto" },
    { "titulo": "Portal oficial do ETIAS", "valor": "https://travel-europe.europa.eu",
      "tipo": "link" },

    // O mesmo bloco guarda os ARQUIVOS do cofre. `tipo: "arquivo"` descreve um
    // documento cujo conteudo e um PDF ou imagem — os BYTES nunca entram no JSON
    // (um backup com trinta PDFs em base64 deixa de ser legivel); eles sobem pela
    // tela, ou por POST /api/documento. Aqui vai so a ficha.
    { "titulo": "Reserva Hotel Madrid",
      "tipo": "arquivo",
      "categoria": "hospedagem",     // pessoal|passaporte|seguro|voo|trem|onibus|
                                     // hospedagem|reserva|ingresso|transfer|
                                     // financeiro|saude|emergencia|outro
      "arquivo_nome": "Reserva_Hotel_Madrid.pdf",
      "cidade": "Madri", "pais": "Espanha",
      "dia": "2027-01-01",           // dia do roteiro a que ele pertence
      "reserva": "Hotel Riu Plaza Espana",  // por NOME; id nao sobrevive a importacao
      "escopo": "global",            // global = do grupo | pessoal = de uma pessoa so
      "dono_nome": null,             // obrigatorio quando escopo = "pessoal"
      "assigned_to_nomes": [],       // com quem mais o dono compartilhou
      "tags": ["hotel", "madri"],
      "importante": false,
      "offline": true,               // deve abrir sem internet durante a viagem
      "validade": null,              // "2031-04-12" num passaporte, por exemplo
      "obs": null },

    { "titulo": "Passaporte do Leonardo",
      "tipo": "arquivo", "categoria": "passaporte",
      "escopo": "pessoal", "dono_nome": "Leonardo",
      "importante": true, "offline": true,
      "validade": "2031-04-12" }
  ],

  // O que a viagem EXIGE de cada pessoa. E o oposto de `documentos`: aquele
  // guarda o que ja existe, este guarda a exigencia — e ela vale mesmo quando
  // ninguem cumpriu, que e o caso interessante.
  "requisitos": [
    { "nome": "Passaporte",
      "descricao": "Passaporte valido durante toda a viagem.",
      "categoria": "passaporte",     // mesma lista de categorias de `documentos`
      "obrigatorio": true,           // false = recomendado, nao conta como pendencia
      "aplica_todos": true,          // true cobre quem entrar na viagem depois
      "assigned_to_nomes": null,     // so quando aplica_todos = false; por NOME
      "exige_numero": true,          // os tres podem coexistir ou vir sozinhos;
      "exige_validade": true,        // nenhum ligado = requisito que so pede
      "exige_arquivo": true,         // o de-acordo da pessoa
      "campo_perfil": "passaporte",  // cpf|rg|passaporte|nascimento|nacionalidade|
                                     // emergencia — puxa do perfil da CONTA, para
                                     // o dado nao ser pedido a cada viagem
      "prazo": "2027-11-30",         // limite para ENVIAR. Nao e a validade acima.
      "obs": null,
      "ordem": 0 },

    { "nome": "Carteira de motorista",
      "categoria": "pessoal", "obrigatorio": false,
      "aplica_todos": false, "assigned_to_nomes": ["Leonardo"],
      "exige_numero": true, "exige_validade": true, "exige_arquivo": true,
      "descricao": "So para quem vai dirigir." }
  ],

  // A ENTREGA de um requisito por uma pessoa. So preencha ao RESTAURAR um
  // backup: numa viagem nova quem entrega e a pessoa, na tela. Entrega inventada
  // marca como resolvido um passaporte que ninguem conferiu.
  "entregas": [
    { "requisito_nome": "Passaporte",   // por NOME, como todo vinculo deste arquivo
      "dono_nome": "Leonardo",
      "numero": "AB123456",
      "validade": "2031-04-12",
      "emitido_em": "2021-04-12",
      "status": "aprovado",             // pendente|enviado|aprovado|rejeitado|correcao
      "comentario": null }               // o que o revisor pediu, quando recusou
  ],

  "emergencia": [
    { "titulo": "Emergência (toda a Europa e Reino Unido)", "telefone": "112",
      "detalhe": "Funciona inclusive sem chip.", "ordem": 0 }
  ],

  "categorias": [
    { "nome": "Passagens", "ordem": 0 }
  ],

  "custos": [
    { "categoria": "Passagens",          // casa por NOME com categorias[]
      "descricao": "Madri → Hamburgo, Iberia, 01/01",
      "valor_centavos": 483500,          // TOTAL da despesa, em centavos (v3)
      "estimado": true,                  // "≈" ou "EST." no documento
      "pagador": "Leonardo Almeida",     // quem pagou o fornecedor, por NOME
      "divisao": "igual",                // igual | peso | personalizado
      "divisoes": [                      // participantes por NOME; vazio = a dividir
        { "participante": "Leonardo Almeida", "peso": 1 }
      ],
      "parcelas": [                      // à vista = uma parcela só
        { "numero": 1, "vence_em": "2026-11-10",
          "valor_centavos": 483500, "pago_centavos": 0 }
      ] }
  ]
}
```

## Erros que o validador pega

| Erro | Mensagem |
| --- | --- |
| `"valor_centavos": 967.00` | `custos[0].valor_centavos: use centavos inteiros, nao reais` |
| `"parte_em": "2026-12-30T10:30:00Z"` | `voos[0].parte_em: use o formato AAAA-MM-DDTHH:MM` |
| `"data_partida": "2026-13-05"` | `viagem.data_partida: data inexistente no calendario` |
| `"papel": "admin"` | `participantes[0].papel: Invalid option` (hoje é `proprietario`/`editor`/`visualizador`) |
| `"lat": 120` | `lugares[0].lat: Too big` |
| `"parcelas": [{ "numero": 0 }]` | `custos[0].parcelas[0].numero: a primeira parcela e a 1` |

## O que a aba HOJE consome

A aba **Hoje** é o roteiro reduzido ao que serve durante a viagem: o compromisso em
curso, o próximo, a hora de sair, onde se dorme e o que falta marcar. Ela não tem
dado próprio — lê o que já está no roteiro. Preencher estes campos é o que separa
um roteiro que só se lê de um que resolve o dia:

| Campo | Onde | O que acende na tela |
| --- | --- | --- |
| `fim_em` | `roteiro[]` | A contagem "1h06 restantes". Sem ele, só o horário de início. |
| `duracao_min` | `roteiro[]` | **"Saia às 11:11"** — o cálculo mais útil da tela. Sem ele, não existe. |
| `distancia_m` | `roteiro[]` | "950 m" ao lado do tempo. |
| `transporte` | `roteiro[]` | O ícone e a palavra: `a_pe`, `metro`, `onibus`, `trem`, `taxi`, `carro`, `barco`, `aviao`. |
| `endereco` | `roteiro[]`, `reservas[]` | O botão **Endereço**, que abre a tela de virar o celular para o motorista. |
| `lat`/`lon` | `roteiro[]`, `lugares[]` | "Abrir no mapa" e o clima da cidade. |
| `telefone` | `reservas[]` | O botão **Telefone** do hotel. |
| `fuso` | `viagem` | Que horas são NO DESTINO quando se abre o app de casa. |

Duas regras ao extrair documentos:

- **`duracao_min` e `distancia_m` moram no item de DESTINO**, não no de origem — é o
  deslocamento *até ali*. "Para chegar no Casa Lucio, 950 m a pé" fica no almoço.
- **Coordenada não se inventa.** Sem `lat`/`lon` no documento, deixe `null`: o mapa
  some, e some é melhor que um pino no lugar errado. O mesmo vale para endereço,
  telefone e horário de término — ausente é melhor que chutado, porque esta é a
  tela que alguém lê com pressa e acredita.

Um ingresso ou voucher aparece na aba Hoje quando o documento está ligado ao item
(`documento.itinerary_event_id`) ou à reserva (`documento.reservation_id`) — é o
mesmo vínculo que o cofre já usa, sem cópia de arquivo.
