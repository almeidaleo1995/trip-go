# Formato do JSON de importação

O contrato executável é `lib/schema.ts`. Em qualquer divergência, **o schema vence este documento** — ele é validado por testes, isto aqui é explicação.

Toda lista é opcional. Uma viagem só com `viagem` e `roteiro` é válida; as abas sem dado mostram estado vazio.

```jsonc
{
  "schemaVersion": 1,

  "viagem": {
    "nome": "Europa 2027",
    "subtitulo": "5 pessoas · 7 países · 17 dias",   // opcional
    "data_partida": "2026-12-30",                     // AAAA-MM-DD, sem hora
    "data_retorno": "2027-01-15",
    "moeda": "EUR",                                   // 3 letras; padrão EUR
    "cor_destaque": "#0F766E"                         // hex de 6 dígitos
  },

  "viajantes": [
    {
      "nome": "Leonardo Almeida",   // exatamente como está no passaporte
      "papel": "admin",             // "admin" | "viajante"; ao menos um admin
      "pin": "4831",                // 4 dígitos; vira hash no import, some do JSON
      "telefone": "+55 47 90000-0000",
      "ordem": 0
    }
  ],

  "roteiro": [
    {
      "ocorre_em": "2026-12-30T10:30",  // hora LOCAL DO DESTINO. sem Z, sem offset
      "titulo": "LA719 Florianópolis → Santiago",
      "cidade": "Florianópolis",
      "local": "Aeroporto Hercílio Luz",
      "descricao": "Check-in internacional pede 3h.",
      "tipo": "voo",       // voo|hospedagem|cruzeiro|passeio|traslado|documento|refeicao
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

  "hospedagens": [
    { "nome": "Hotel em Madri", "cidade": "Madri",
      "checkin": "2026-12-31", "checkout": "2027-01-01",   // noites são calculadas
      "endereco": null, "link": null }
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
      "ordem": 0 }
  ],

  "documentos": [
    { "titulo": "Localizador LATAM", "valor": "WSZIAK", "tipo": "texto" },
    { "titulo": "Portal oficial do ETIAS", "valor": "https://travel-europe.europa.eu",
      "tipo": "link" }
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
      "valor_centavos": 96700,           // valor POR PESSOA, em centavos
      "pessoas": 5,                      // o app multiplica; não pré-multiplique
      "estimado": true,                  // "≈" ou "EST." no documento
      "pago": false }
  ]
}
```

## Erros que o validador pega

| Erro | Mensagem |
| --- | --- |
| `"valor_centavos": 967.00` | `custos[0].valor_centavos: use centavos inteiros, nao reais` |
| `"parte_em": "2026-12-30T10:30:00Z"` | `voos[0].parte_em: use o formato AAAA-MM-DDTHH:MM` |
| `"data_partida": "2026-13-05"` | `viagem.data_partida: data inexistente no calendario` |
| `"pin": "123"` | `viajantes[0].pin: o PIN precisa ter exatamente 4 digitos` |
| `"lat": 120` | `lugares[0].lat: Too big` |
| `"pessoas": 0` | `custos[0].pessoas: precisa ser pelo menos 1` |
