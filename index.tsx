import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from "react-markdown";

// --- Types ---
interface Option {
  label: string;
  sub?: string;
  value: string;
}

interface FormField {
  id: string;
  type: "text" | "select" | "radio" | "checkbox";
  label: string;
  placeholder?: string;
  defaultValue?: string; // Added to support pre-selection
  options?: string[];
  max_select?: number; // For checkboxes
}

interface FormSchema {
  titulo: string;
  fields: FormField[];
}

interface RollRequest {
  dado: string;
  motivo: string;
  dificuldade_oculta?: number;
}

interface InterfaceData {
  modo: "rolagem" | "botoes" | "formulario" | "texto_livre";
  permitir_input_livre?: boolean; // Controls if text input is shown alongside buttons
  pedir_rolagem?: RollRequest;
  conteudo?: Option[] | FormSchema; // Can be buttons or a form schema
}

interface JsonData {
  status_jogador: {
    nome: string;
    titulo: string;
    hp_atual: number;
    hp_max: number;
    local: string;
    missao?: string;
    inventario?: string[];
    atributos?: Record<string, string>; // Added attributes
  };
  update_avatar?: {
    trigger: boolean;
    visual_prompt?: string;
    style?: string;
  };
  interface: InterfaceData;
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  isStreaming?: boolean;
  imageUrl?: string;
  isGeneratingImage?: boolean;
  jsonData?: JsonData; // Parsed JSON data
  isSavePoint?: boolean;
  options?: Option[];
  form?: FormSchema;
}

interface GameStatus {
  nome: string;
  titulo: string;
  hp_atual: number;
  hp_max: number;
  local: string;
  missao: string;
  avatarUrl?: string;
  inventario?: string[];
  atributos?: Record<string, string>; // Added attributes
}

// --- Constants & Config ---
const MODEL_NAME = "gemini-2.5-flash";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";
const TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts";

// --- Tactical Guides for Attributes ---
const CLASS_STATS_GUIDE: Record<string, { primary: string[], optimal: Record<string, string> }> = {
    "guerreiro": {
        primary: ["for", "con"],
        optimal: { for: "15", con: "14", des: "13", sab: "12", car: "10", int: "8" }
    },
    "ladino": {
        primary: ["des", "int"],
        optimal: { des: "15", int: "14", con: "13", car: "12", sab: "10", for: "8" }
    },
    "mago": {
        primary: ["int", "con"],
        optimal: { int: "15", con: "14", des: "13", sab: "12", car: "10", for: "8" }
    },
    "clérigo": {
        primary: ["sab", "con"],
        optimal: { sab: "15", con: "14", for: "13", car: "12", int: "10", des: "8" }
    },
     "patrulheiro": {
        primary: ["des", "sab"],
        optimal: { des: "15", sab: "14", con: "13", for: "12", int: "10", car: "8" }
    }
};

const SYSTEM_INSTRUCTION = `
**PERSONA:**
Você é o Mestre dos Calabouços (DM) experiente, imparcial e descritivo, narrando uma campanha de D&D 5ª Edição no cenário do Grão-Ducado de Karameikos (Mystara).

**FONTES DE CONHECIMENTO:**
1. Use o cenário de "Karameikos" (Mystara) para geografia, política (conflito Thyatianos vs. Traladaranos), NPCs importantes (Duque Stefan, Barão Ludwig) e monstros locais.
2. Use os livros de "D&D 5e" (Livro do Jogador, Mestre, Monstros) APENAS para as mecânicas de regras, testes, classes e combate.

**REGRAS DE DADOS (VISUAL):**
Sempre mostre a matemática dos dados narrados entre colchetes. Exemplo: [🎲 d20(14) + 5 (força) = 19]

**PROTOCOLO DE SAÍDA (IMPORTANTE - JSON DATA):**
Toda resposta sua deve terminar com narrativa e, NO FINAL, um bloco JSON oculto separado por "--- [JSON_DATA] ---".
Este JSON é a ÚNICA fonte da verdade para a interface do jogo.

**ESTRUTURA DO JSON:**
\`\`\`json
{
  "status_jogador": { 
      "nome": "String (Use 'Desconhecido' se não souber)", 
      "titulo": "String (Ex: 'Nível 1 • Ladino')",
      "hp_atual": Number, 
      "hp_max": Number, 
      "local": "Nome do Local",
      "missao": "Objetivo atual",
      "inventario": ["Item 1", "Item 2"],
      "atributos": { "Força": "15 (+2)", "Destreza": "12 (+1)", ... } // Opcional, envie APENAS quando houver atualização relevante (ex: criação de ficha)
  },
  "update_avatar": {
      "trigger": Boolean,  // True se o visual do personagem mudou ou foi criado
      "visual_prompt": "String para gerar imagem do rosto (opcional)", 
      "style": "Dark Fantasy RPG Art"
  },
  "interface": {
      "modo": "String ('rolagem' | 'botoes' | 'formulario' | 'texto_livre')",
      "permitir_input_livre": Boolean, // SE TRUE, exibe campo de texto abaixo dos botões
      "pedir_rolagem": { // PREENCHER SE MODO == 'rolagem'
          "dado": "d20",
          "motivo": "Teste de Furtividade",
          "dificuldade_oculta": 12
      },
      "conteudo": [ ... ] // Lista de opções (se botoes) ou Schema do formulário (se formulario)
  }
}
\`\`\`

**PROTOCOLO DE AGÊNCIA DO JOGADOR (INPUT LIVRE):**
1. **Improvisação:** Em RPGs de mesa, a liberdade é total. Nunca limite o jogador apenas às opções pré-calculadas.
2. **Instrução de Interface:** Sempre que você oferecer escolhas (botões), você DEVE sinalizar para a interface que a **Caixa de Texto Livre** também deve estar ativa.
3. **No JSON:** Defina a propriedade \`"permitir_input_livre": true\` dentro do objeto de interface. Isso fará o aplicativo exibir o campo de digitação abaixo dos botões.

**REGRAS DE INTERFACE E CRIAÇÃO DE PERSONAGEM (PASSO A PASSO):**

**PASSO 1: DADOS INICIAIS**
- Ao iniciar, envie \`interface.modo = "formulario"\` com o schema.
- **IMPORTANTE:** Se o jogador escolheu um arquétipo (Legionário, Raposa, Erudito), adicione \`"defaultValue": "Nome da Classe"\` no campo "classe" para vir pré-selecionado.
   - Legionário -> "Guerreiro (Thyatiano)"
   - Raposa -> "Ladino (Traladarano)"
   - Erudito -> "Mago (Glantri)"

   **SCHEMA BASE:**
   \`\`\`json
   {
      "titulo": "Registro de Aventureiro",
      "fields": [
          { "id": "nome", "type": "text", "label": "Nome do Personagem", "placeholder": "Ex: Voron" },
          { "id": "classe", "type": "select", "label": "Classe Escolhida", "defaultValue": null, "options": ["Guerreiro (Thyatiano)", "Ladino (Traladarano)", "Mago (Glantri)", "Clérigo (Karameikos)"] },
          { "id": "atributos", "type": "select", "label": "Método de Atributos", "options": ["Arranjo Padrão (15, 14, 13, 12, 10, 8)", "Rolagem de Dados (4d6 drop lowest)", "Compra de Pontos (27 pts)"] },
          { "id": "equipamento", "type": "radio", "label": "Kit Inicial", "options": ["Kit Aventureiro (Mochila/Corda)", "Kit Explorador (Rações/Tochas)"] }
      ]
   }
   \`\`\`

**PASSO 2: DISTRIBUIÇÃO DE ATRIBUTOS (PÓS-SUBMISSÃO)**
Assim que o jogador enviar o formulário acima:
1. **Analise o método escolhido.**
   - Se for **Rolagem**: ROLE os dados explicitamente no texto (ex: "Rolei 6 vezes: 16, 14, 12...").
   - Se for **Compra**: Relembre os custos (8=0, 15=9).
2. **Envie IMEDIATAMENTE um SEGUNDO formulário** para alocação.
   - Os placeholders dos campos serão preenchidos automaticamente pela interface, mas envie o schema abaixo.

   **SCHEMA ALOCAÇÃO:**
   \`\`\`json
   {
      "titulo": "Alocação de Atributos",
      "fields": [
        { "id": "for", "type": "text", "label": "Força", "placeholder": "..." },
        { "id": "des", "type": "text", "label": "Destreza", "placeholder": "..." },
        { "id": "con", "type": "text", "label": "Constituição", "placeholder": "..." },
        { "id": "int", "type": "text", "label": "Inteligência", "placeholder": "..." },
        { "id": "sab", "type": "text", "label": "Sabedoria", "placeholder": "..." },
        { "id": "car", "type": "text", "label": "Carisma", "placeholder": "..." }
      ]
   }
   \`\`\`

3. **FINALIZAÇÃO DE PERSONAGEM:**
   - Após o jogador submeter os atributos, calcule os modificadores (ex: 15 = +2).
   - Preencha o campo \`atributos\` no JSON \`status_jogador\`.
   - **GERE UMA IMAGEM** do personagem usando o gatilho \`--- [CENA VISUAL SUGERIDA] ---\`.

3. **OPÇÕES DE AÇÃO (BOTOES):**
   - Em momentos de decisão ou combate, use \`interface.modo = "botoes"\` e \`"permitir_input_livre": true\`.
   - Forneça 3 a 4 opções táticas e claras no array \`interface.conteudo\`.

**SISTEMA DE SAVE/LOAD:**
Se solicitado "Save", gere um bloco de texto visível com \`[CHECKPOINT_KARAMEIKOS]\`.

**SISTEMA DE RETRATO & CENAS:**
Para gerar imagens de cenário, use o bloco \`--- [CENA VISUAL SUGERIDA] ---\` dentro da narrativa.
`;

const INITIAL_BUTTONS: Option[] = [
  { label: "Legionário Thyatiano", sub: "Guerreiro Humano", value: "Eu sou um Legionário Thyatiano (Guerreiro Humano). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "\"Raposa\" Traladarana", sub: "Ladino Humano", value: "Eu sou uma 'Raposa' Traladarana (Ladino Humano). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "Erudito de Glantri", sub: "Mago Elfo", value: "Eu sou um Erudito de Glantri (Mago Elfo). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "✨ Criar meu próprio", sub: "Personalizado", value: "Gostaria de criar meu próprio personagem. (SISTEMA: Responda IMEDIATAMENTE com interface.modo='formulario' usando o SCHEMA OBRIGATÓRIO de criação de ficha)." },
];

const INITIAL_MESSAGE: Message = {
    id: 'intro',
    role: 'model',
    text: "Bem-vindo a Karameikos. A névoa cobre as montanhas escarpadas ao norte, enquanto as tensões entre os nativos Traladaranos e os conquistadores Thyatianos fervem nas cidades. Você se encontra na estrada perto de Threshold. O vento uiva, carregando o cheiro de chuva e... algo mais metálico.\n\nAntes de começarmos, quem é você?",
    options: INITIAL_BUTTONS,
    jsonData: {
        status_jogador: { nome: "Desconhecido", titulo: "Aventureiro", hp_atual: 10, hp_max: 10, local: "Estrada de Threshold", missao: "Sobreviver", inventario: [] },
        interface: { modo: "botoes", permitir_input_livre: true, conteudo: INITIAL_BUTTONS }
    }
}

// --- Icons & Decoration Components ---

const CornerDecoration = ({ className }: { className: string }) => (
  <svg viewBox="0 0 50 50" className={`w-8 h-8 text-yellow-700/60 absolute ${className}`} fill="currentColor">
    <path d="M0,0 v15 q5,0 10,5 t5,10 h15 v-30 z" />
    <path d="M5,5 l15,15" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const DividerDecoration = () => (
  <div className="flex items-center justify-center gap-2 my-4 opacity-70">
     <div className="h-[1px] w-12 bg-gradient-to-r from-transparent to-yellow-700"></div>
     <svg viewBox="0 0 24 24" className="w-5 h-5 text-yellow-600" fill="currentColor">
        <path d="M12 2L14.5 10H9.5L12 2Z" />
        <path d="M12 22L9.5 14H14.5L12 22Z" />
        <circle cx="12" cy="12" r="2" />
     </svg>
     <div className="h-[1px] w-12 bg-gradient-to-l from-transparent to-yellow-700"></div>
  </div>
);

// --- Audio Utils ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --- Fallback Schema (Security) ---
const DEFAULT_CHAR_SHEET: FormSchema = {
    titulo: "Registro de Aventureiro",
    fields: [
        { 
            id: "nome", 
            type: "text", 
            label: "Nome do Herói", 
            placeholder: "Ex: Voron, o Astuto" 
        },
        { 
            id: "classe", 
            type: "select", 
            label: "Vocação (Classe)", 
            options: ["Guerreiro (Soldado)", "Ladino (Criminoso)", "Mago (Erudito)", "Clérigo (Acólito)", "Patrulheiro (Caçador)"] 
        },
        { 
            id: "atributos", 
            type: "select", 
            label: "Método de Atributos", 
            options: ["Arranjo Padrão (15, 14, 13, 12, 10, 8)", "Rolagem de Dados (4d6 drop lowest)", "Compra de Pontos (27 pts)"] 
        },
        { 
            id: "origem", 
            type: "radio", 
            label: "Origem Regional", 
            options: ["Nativo de Karameikos", "Invasor Thyatiano", "Elfo de Alfheim", "Anão de Rockhome"] 
        }
    ]
};

// --- Dynamic Form Component (Hardened) ---

const DynamicForm = ({ 
    schema, 
    onSubmit,
    context 
}: { 
    schema: any, 
    onSubmit: (values: Record<string, string | string[]>) => void,
    context?: { userClass?: string, method?: string }
}) => {
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // LÓGICA DE SEGURANÇA (FALLBACK)
    // 1. Pega o schema da IA ou usa vazio
    let activeSchema = schema || {};
    
    // 2. Verifica se a IA mandou campos genéricos ("Campo 1", "Field 1") ou lista vazia
    const fields = Array.isArray(activeSchema.fields) ? activeSchema.fields : [];
    const hasGenericFields = fields.some((f: any) => f.label?.toLowerCase().includes("campo") || f.label?.toLowerCase().includes("field"));
    const isEmpty = fields.length === 0;

    // 3. Se estiver quebrado, ATIVA O PLANO B (Ficha Padrão)
    if (isEmpty || hasGenericFields) {
        activeSchema = DEFAULT_CHAR_SHEET;
    }
    
    // Garante que usamos os campos finais decididos acima
    const safeFields = activeSchema.fields;

    // DETECTA SE É FORM DE ALOCAÇÃO DE ATRIBUTOS
    const isAttributeAllocation = activeSchema.titulo?.toLowerCase().includes("alocação") || 
                                  activeSchema.titulo?.toLowerCase().includes("atributos");

    // Initialize Default Values if provided by Schema
    useEffect(() => {
        const defaults: Record<string, any> = {};
        safeFields.forEach((field: any) => {
            if (field.defaultValue) {
                defaults[field.id] = field.defaultValue;
            }
        });
        if (Object.keys(defaults).length > 0) {
            setFormData(prev => ({ ...defaults, ...prev }));
        }
    }, [activeSchema]);

    const handleInputChange = (id: string, value: string) => {
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleCheckboxChange = (id: string, option: string, max: number) => {
        setFormData(prev => {
            const current = prev[id] || [];
            if (current.includes(option)) {
                return { ...prev, [id]: current.filter((item: string) => item !== option) };
            } else {
                if (max && current.length >= max) return prev;
                return { ...prev, [id]: [...current, option] };
            }
        });
    };

    // --- Helper to Determine Placeholder & Style for Attributes ---
    const getAttributeConfig = (fieldId: string) => {
        if (!isAttributeAllocation || !context?.userClass) return { placeholder: undefined, isPrimary: false };
        
        // Find matching class guide (simple string matching)
        const classKey = Object.keys(CLASS_STATS_GUIDE).find(k => 
            context.userClass!.toLowerCase().includes(k)
        );
        
        if (!classKey) return { placeholder: "Valor...", isPrimary: false };
        
        const guide = CLASS_STATS_GUIDE[classKey];
        const isPrimary = guide.primary.includes(fieldId);
        const isStandardArray = context.method?.toLowerCase().includes("padrão") || context.method?.toLowerCase().includes("standard");

        let placeholder = "Valor...";
        if (isStandardArray) {
            placeholder = `Sugerido: ${guide.optimal[fieldId] || "8"}`;
        } else {
            placeholder = isPrimary ? "⭐ Principal (Max)" : "Secundário";
        }

        return { placeholder, isPrimary };
    };

    return (
        <div className="mt-8 mx-auto max-w-lg relative group animate-fade-in">
             {/* Efeito de Borda Dourada */}
             <div className="absolute -inset-0.5 bg-gradient-to-b from-yellow-800 to-yellow-950 rounded-lg opacity-50 blur-[2px]"></div>
             
             <div className="relative bg-[#1a1816] border border-yellow-900/60 p-6 rounded-lg shadow-2xl">
                 <div className="mb-6 text-center border-b border-yellow-900/30 pb-4">
                     <h3 className="text-yellow-600 font-fantasy text-xl tracking-[0.2em] uppercase drop-shadow-md">
                        {activeSchema.titulo || "Ficha de Personagem"}
                     </h3>
                 </div>

                 {/* STAT BANK HELPER FOR ALLOCATION */}
                 {isAttributeAllocation && (
                     <div className="mb-6 p-4 bg-stone-900/50 border border-stone-700 rounded-lg text-center animate-fade-in">
                         <span className="text-[10px] text-stone-500 uppercase tracking-[0.2em] block mb-2 font-bold">
                             Banco de Valores (Arranjo Padrão)
                         </span>
                         <div className="flex justify-center gap-3 font-fantasy text-lg md:text-xl text-yellow-500">
                             <span className="bg-black/40 px-2 rounded border border-yellow-900/30">15</span>
                             <span className="bg-black/40 px-2 rounded border border-yellow-900/30">14</span>
                             <span className="bg-black/40 px-2 rounded border border-yellow-900/30">13</span>
                             <span className="bg-black/40 px-2 rounded border border-yellow-900/30">12</span>
                             <span className="bg-black/40 px-2 rounded border border-yellow-900/30">10</span>
                             <span className="bg-black/40 px-2 rounded border border-yellow-900/30 text-stone-500">8</span>
                         </div>
                         <p className="text-xs text-stone-600 mt-2 italic font-serif">
                             Distribua estes valores nos campos abaixo conforme sua estratégia.
                         </p>
                     </div>
                 )}

                 <form onSubmit={(e) => { e.preventDefault(); setIsSubmitting(true); onSubmit(formData); }} className="space-y-5">
                    {safeFields.map((field: any, idx: number) => {
                        const { placeholder: smartPlaceholder, isPrimary } = getAttributeConfig(field.id);
                        
                        return (
                        <div key={field.id || idx} className="flex flex-col gap-2">
                            <label className="text-stone-400 text-xs font-bold uppercase tracking-widest flex justify-between items-center">
                                <span className={isPrimary ? "text-yellow-500" : ""}>{field.label}</span>
                                {isPrimary && <span className="text-[10px] text-yellow-600 ml-2">★ RECOMENDADO</span>}
                                {field.max_select && <span className="text-[10px] text-stone-600">(Max: {field.max_select})</span>}
                            </label>
                            
                            {field.type === 'text' && (
                                <input 
                                    type="text"
                                    placeholder={smartPlaceholder || field.placeholder}
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                                    className={`bg-black/30 border rounded p-3 text-stone-200 outline-none font-serif w-full placeholder-stone-600 focus:placeholder-stone-500/50
                                        ${isPrimary 
                                            ? 'border-yellow-700/60 ring-1 ring-yellow-900/30 focus:border-yellow-500' 
                                            : 'border-stone-700 focus:border-yellow-700'}
                                    `}
                                />
                            )}

                            {field.type === 'select' && (
                                 <div className="relative">
                                     <select
                                        value={formData[field.id] || ''}
                                        onChange={(e) => handleInputChange(field.id, e.target.value)}
                                        className="w-full bg-black/30 border border-stone-700 rounded p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif appearance-none cursor-pointer"
                                     >
                                        <option value="">Selecione...</option>
                                        {(field.options || []).map((opt: string, i: number) => (
                                            <option key={i} value={opt}>{opt}</option>
                                        ))}
                                     </select>
                                     <div className="absolute right-3 top-3.5 text-stone-500 pointer-events-none text-xs">▼</div>
                                </div>
                            )}

                            {/* DYNAMIC HELPERS FOR ATTRIBUTES (PASSO 1) */}
                            {field.id === 'atributos' && formData[field.id] && (
                                <div className="animate-fade-in mt-3 space-y-3">
                                    {/* Rolagem Helper */}
                                    {formData[field.id].toString().toLowerCase().includes('rolagem') && (
                                        <div className="p-3 bg-indigo-900/40 border border-indigo-500/30 rounded text-xs text-indigo-200 font-serif shadow-inner">
                                            <p className="font-bold text-indigo-100 mb-1 flex items-center gap-2">
                                                <span className="text-lg">🎲</span> O Destino Decide
                                            </p>
                                            <p>Ao confirmar, o Mestre rolará 4d6 (descartando o menor) 6 vezes para você.</p>
                                        </div>
                                    )}
                                    
                                    {/* Point Buy Helper */}
                                    {formData[field.id].toString().toLowerCase().includes('compra') && (
                                        <div className="p-3 bg-emerald-900/40 border border-emerald-500/30 rounded text-xs text-emerald-200 font-serif shadow-inner">
                                            <p className="font-bold text-emerald-100 mb-2 flex items-center gap-2">
                                                <span className="text-lg">⚖️</span> Compra de Pontos (Total: 27)
                                            </p>
                                            <div className="grid grid-cols-4 gap-2 text-center opacity-90">
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">8 = 0</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">9 = 1</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">10 = 2</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">11 = 3</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">12 = 4</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">13 = 5</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">14 = 7</div>
                                                <div className="bg-black/20 p-1 rounded border border-emerald-500/20">15 = 9</div>
                                            </div>
                                        </div>
                                    )}

                                     {/* Standard Array Helper */}
                                     {formData[field.id].toString().toLowerCase().includes('padrão') && (
                                        <div className="p-3 bg-stone-800/60 border border-stone-600/30 rounded text-xs text-stone-300 font-serif shadow-inner">
                                             <p className="font-bold text-stone-200 mb-1">Valores Fixos:</p>
                                             <p className="tracking-widest">15, 14, 13, 12, 10, 8</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {(field.type === 'radio' || field.type === 'checkbox') && (
                                <div className="flex flex-col gap-2 bg-black/20 p-2 rounded border border-stone-800/50">
                                    {(field.options || []).map((opt: string, i: number) => {
                                        const isSelected = field.type === 'radio' ? formData[field.id] === opt : (formData[field.id] || []).includes(opt);
                                        return (
                                            <label key={i} className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-1 rounded transition-colors">
                                                <div className={`w-3 h-3 rounded flex items-center justify-center ${isSelected ? 'bg-yellow-800 border-yellow-600' : 'border border-stone-600'}`}>
                                                    {isSelected && <div className="w-1.5 h-1.5 bg-yellow-200 rounded-full"></div>}
                                                </div>
                                                {field.type === 'radio' ? (
                                                    <input type="radio" name={field.id} checked={isSelected} onChange={() => handleInputChange(field.id, opt)} className="hidden" />
                                                ) : (
                                                    <input type="checkbox" checked={isSelected} onChange={() => handleCheckboxChange(field.id, opt, field.max_select)} className="hidden" />
                                                )}
                                                <span className={`text-sm ${isSelected ? 'text-yellow-100' : 'text-stone-400'}`}>{opt}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );})}

                    <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full mt-6 bg-gradient-to-r from-yellow-900 to-yellow-800 hover:from-yellow-800 hover:to-yellow-700 text-stone-200 font-bold py-3 rounded border border-yellow-700/50 uppercase tracking-widest shadow-lg transition-all"
                    >
                        {isSubmitting ? "Gravando..." : "Confirmar Destino"}
                    </button>
                 </form>
             </div>
        </div>
    );
}

// --- Main App Component ---

const App = () => {
    const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
    const [status, setStatus] = useState<GameStatus>({
        nome: "Desconhecido", titulo: "Aventureiro", hp_atual: 10, hp_max: 10, local: "Estrada de Threshold", missao: "Sobreviver", inventario: [], atributos: undefined
    });
    const [inputText, setInputText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [inputMode, setInputMode] = useState<"texto_livre" | "botoes" | "rolagem" | "formulario">("botoes");
    const [allowFreeInput, setAllowFreeInput] = useState(true); // Default to true for initial screen
    const [currentOptions, setCurrentOptions] = useState<Option[]>(INITIAL_BUTTONS);
    const [currentRollRequest, setCurrentRollRequest] = useState<RollRequest | null>(null);
    const [currentFormSchema, setCurrentFormSchema] = useState<FormSchema | null>(null);
    
    // Track character creation context to provide hints in the second form
    const [charCreationContext, setCharCreationContext] = useState<{userClass?: string, method?: string} | undefined>(undefined);

    // Audio State
    const [isAudioEnabled, setIsAudioEnabled] = useState(false);
    const [volume, setVolume] = useState(1.0);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, inputMode, allowFreeInput]);

    // Initialize Audio Context on user interaction (handled in toggle)
    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume;
        }
    }, [volume]);

    const playTTS = async (text: string) => {
        if (!isAudioEnabled) return;

        try {
            // Initialize AudioContext if not present (browsers require user interaction first)
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                gainNodeRef.current = audioContextRef.current.createGain();
                gainNodeRef.current.connect(audioContextRef.current.destination);
                gainNodeRef.current.gain.value = volume;
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            setIsSpeaking(true);
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // Clean text for speech (remove JSON and maybe some markdown visual cues)
            const cleanText = text
                .split("--- [JSON_DATA] ---")[0] // Remove JSON
                .replace(/\[🎲.*?\]/g, "") // Remove dice visuals ex: [🎲 d20(15)...]
                .replace(/\*/g, "") // Remove asterisks
                .trim();

            if (!cleanText) {
                setIsSpeaking(false);
                return;
            }

            const response = await ai.models.generateContent({
                model: TTS_MODEL_NAME,
                contents: [{ parts: [{ text: cleanText }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, // "Fenrir" for deep DM voice
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current && gainNodeRef.current) {
                const audioBuffer = await audioContextRef.current.decodeAudioData(decode(base64Audio).buffer);
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(gainNodeRef.current);
                source.start();
                source.onended = () => setIsSpeaking(false);
            } else {
                setIsSpeaking(false);
            }
        } catch (error) {
            console.error("TTS Error:", error);
            setIsSpeaking(false);
        }
    };

    const handleSendMessage = async (text: string, isSystemRoll: boolean = false) => {
        if (!text || !text.trim()) return;

        const userMsg: Message = { id: Date.now().toString(), role: "user", text };
        setMessages(prev => [...prev, userMsg]);
        setInputText("");
        setIsLoading(true);
        setInputMode("texto_livre"); // Reset momentarily while thinking

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            // Build history
            const history = messages.map(m => {
               if (m.role === 'model') {
                   // Strip JSON from history to save tokens and confusion, 
                   // unless it's crucial context. Usually prompt is enough.
                   return { role: m.role, parts: [{ text: m.text }] };
               }
               return { role: m.role, parts: [{ text: m.text }] };
            });

            // Add new message
            history.push({ role: "user", parts: [{ text: text }] });

            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: history,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                }
            });

            const responseText = response.text || "";
            
            // Parse Logic
            const parts = responseText.split("--- [JSON_DATA] ---");
            const narrative = parts[0].trim();
            let jsonData: JsonData | null = null;
            let finalOptions: Option[] = [];
            let finalRoll: RollRequest | null = null;
            let finalForm: FormSchema | null = null;
            let nextMode: "texto_livre" | "botoes" | "rolagem" | "formulario" = "texto_livre";
            let nextAllowInput = false;
            let imageUrl: string | undefined = undefined;

            // Handle Scene generation hook
            if (narrative.includes("--- [CENA VISUAL SUGERIDA] ---")) {
                const scenePrompt = "Dark fantasy rpg landscape, " + narrative.substring(0, 100);
                try {
                    const imgRes = await ai.models.generateContent({
                        model: IMAGE_MODEL_NAME,
                        contents: { parts: [{ text: scenePrompt }] }
                    });
                     // Extract base64
                    const part = imgRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                    if (part) {
                        imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    }
                } catch (e) { console.error("Image gen failed", e); }
            }

            if (parts[1]) {
                try {
                    const cleanJson = parts[1].trim().replace(/```json/g, "").replace(/```/g, "");
                    jsonData = JSON.parse(cleanJson);
                    
                    if (jsonData) {
                        // Update Status
                        if (jsonData.status_jogador) {
                            setStatus(prev => ({ ...prev, ...jsonData!.status_jogador }));
                        }
                        
                        // Handle Avatar Update
                        if (jsonData.update_avatar?.trigger && jsonData.update_avatar.visual_prompt) {
                             const avatarPrompt = "Fantasy RPG Portrait, " + jsonData.update_avatar.visual_prompt;
                             const avatarRes = await ai.models.generateContent({
                                model: IMAGE_MODEL_NAME,
                                contents: { parts: [{ text: avatarPrompt }] }
                             });
                             const part = avatarRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                             if (part) {
                                 setStatus(prev => ({ ...prev, avatarUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }));
                             }
                        }

                        // Handle Interface
                        if (jsonData.interface) {
                            nextMode = jsonData.interface.modo;
                            nextAllowInput = !!jsonData.interface.permitir_input_livre;
                            
                            if (nextMode === 'botoes') {
                                if (Array.isArray(jsonData.interface.conteudo) && jsonData.interface.conteudo.length > 0) {
                                    finalOptions = jsonData.interface.conteudo as Option[];
                                } else {
                                    // Fallback if AI requests buttons but sends empty list
                                    finalOptions = [{ label: "Continuar", value: "Continuar" }];
                                }
                            } else if (nextMode === 'rolagem' && jsonData.interface.pedir_rolagem) {
                                finalRoll = jsonData.interface.pedir_rolagem;
                            } else if (nextMode === 'formulario' && jsonData.interface.conteudo) {
                                finalForm = jsonData.interface.conteudo as FormSchema;
                            }
                        }
                    }
                } catch (e) {
                    console.error("JSON Parse Error", e);
                }
            }

            const modelMsg: Message = {
                id: Date.now().toString(),
                role: "model",
                text: narrative,
                jsonData: jsonData || undefined,
                options: finalOptions,
                imageUrl: imageUrl,
                form: finalForm || undefined
            };

            setMessages(prev => [...prev, modelMsg]);
            setInputMode(nextMode);
            setAllowFreeInput(nextAllowInput);
            
            // Trigger TTS
            playTTS(narrative);

            // Safety: If buttons are requested, ensure options exist. If not, clear them.
            if (nextMode === 'botoes') {
                setCurrentOptions(finalOptions);
            } else {
                setCurrentOptions([]);
            }

            if (finalRoll) setCurrentRollRequest(finalRoll);
            if (finalForm) setCurrentFormSchema(finalForm);


        } catch (error) {
            console.error("API Error", error);
            const errorMsg: Message = {
                id: Date.now().toString(),
                role: "model",
                text: "O tecido da realidade tremeu (Erro de API). Tente novamente."
            };
            setMessages(prev => [...prev, errorMsg]);
            setInputMode("texto_livre");
        } finally {
            setIsLoading(false);
        }
    };

    const handleRoll = (result: number, max: number) => {
        handleSendMessage(`[SISTEMA: O Jogador rolou d${max} e obteve: ${result}]`, true);
    };

    const handleFormSubmit = (values: Record<string, string | string[]>) => {
        // Capture context if this is the character registration form
        if (values.classe && values.atributos) {
            setCharCreationContext({
                userClass: values.classe as string,
                method: values.atributos as string
            });
        }
        
        const valueString = JSON.stringify(values);
        handleSendMessage(`[SISTEMA: Ficha preenchida: ${valueString}]`, true);
    };

    // Helper to render the text input area to avoid duplication
    const renderInputArea = () => (
        <div className="flex gap-2 max-w-4xl mx-auto w-full">
            <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSendMessage(inputText)}
                placeholder="O que você faz?"
                disabled={isLoading}
                className="flex-1 bg-stone-900 border border-stone-700 text-stone-200 p-3 rounded focus:border-yellow-700 outline-none font-serif"
            />
            <button
                onClick={() => handleSendMessage(inputText)}
                disabled={isLoading || !inputText.trim()}
                className="bg-yellow-900/30 text-yellow-600 border border-yellow-800/50 px-6 rounded font-bold hover:bg-yellow-900/50 disabled:opacity-50 transition-colors uppercase tracking-widest text-sm"
            >
                Enviar
            </button>
        </div>
    );

    return (
        <div className="flex h-full w-full bg-[#1a1816] text-[#d1c4b2] overflow-hidden font-sans">
            {/* Sidebar - Desktop Only for now or simplistic */}
            <div className="hidden md:flex flex-col w-72 border-r border-[#3e352f] bg-[#141210] p-4 gap-4 overflow-y-auto">
                 <div className="flex flex-col items-center gap-2 mb-4">
                     <div className="w-32 h-32 rounded-full border-2 border-yellow-900 overflow-hidden bg-black shadow-lg relative">
                         {status.avatarUrl ? (
                             <img src={status.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                         ) : (
                             <div className="w-full h-full flex items-center justify-center text-4xl text-stone-700">?</div>
                         )}
                     </div>
                     <h2 className="font-fantasy text-xl text-yellow-600">{status.nome}</h2>
                     <span className="text-xs uppercase tracking-widest text-stone-500">{status.titulo}</span>
                 </div>

                 <div className="space-y-4">
                     <div>
                         <div className="flex justify-between text-xs uppercase font-bold text-stone-500 mb-1">
                             <span>Vitalidade</span>
                             <span>{status.hp_atual}/{status.hp_max}</span>
                         </div>
                         <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
                             <div 
                                className="h-full bg-red-800 transition-all duration-500" 
                                style={{ width: `${(status.hp_atual / status.hp_max) * 100}%`}}
                             ></div>
                         </div>
                     </div>

                     <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f]">
                         <h4 className="text-xs uppercase font-bold text-stone-500 mb-2">Local Atual</h4>
                         <p className="font-serif text-sm text-stone-300">{status.local}</p>
                     </div>

                     <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f]">
                         <h4 className="text-xs uppercase font-bold text-stone-500 mb-2">Missão</h4>
                         <p className="font-serif text-sm text-stone-300 italic">"{status.missao}"</p>
                     </div>

                     <DividerDecoration />

                     {/* AUDIO CONTROLS */}
                     <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f] space-y-3">
                         <div className="flex justify-between items-center">
                            <h4 className="text-xs uppercase font-bold text-stone-500">Narração do Mestre</h4>
                            {isSpeaking && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>}
                         </div>
                         
                         <label className="flex items-center gap-2 cursor-pointer">
                             <div className="relative">
                                 <input type="checkbox" className="hidden" checked={isAudioEnabled} onChange={() => setIsAudioEnabled(!isAudioEnabled)} />
                                 <div className={`w-10 h-5 rounded-full shadow-inner transition-colors ${isAudioEnabled ? 'bg-yellow-900' : 'bg-stone-700'}`}></div>
                                 <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-stone-300 shadow transition-transform ${isAudioEnabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
                             </div>
                             <span className="text-sm text-stone-400">{isAudioEnabled ? "Ligado" : "Desligado"}</span>
                         </label>

                         <div>
                             <h4 className="text-xs uppercase font-bold text-stone-500 mb-1">Volume</h4>
                             <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.1" 
                                value={volume} 
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="w-full h-1 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-yellow-700"
                             />
                         </div>
                     </div>
                 </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col relative">
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}>
                             <div className={`max-w-[90%] md:max-w-[80%] rounded-lg p-4 md:p-6 shadow-xl ${
                                 msg.role === 'user' 
                                 ? 'bg-stone-800/80 text-stone-200 border border-stone-700' 
                                 : 'bg-[#1e1c19]/90 text-[#d1c4b2] border border-[#3e352f]'
                             }`}>
                                 {msg.imageUrl && (
                                     <div className="mb-4 rounded-lg overflow-hidden border border-stone-700 relative group">
                                         <img src={msg.imageUrl} alt="Scene" className="w-full h-auto max-h-[60vh] object-cover" />
                                         
                                         {/* Character Stats Overlay */}
                                         {msg.jsonData?.status_jogador?.atributos && (
                                            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center p-6 text-center backdrop-blur-[2px] transition-opacity duration-700 opacity-0 animate-fade-in group-hover:opacity-100">
                                                <h3 className="font-fantasy text-2xl md:text-4xl text-yellow-500 mb-4 drop-shadow-lg border-b border-yellow-800/50 pb-2 w-full max-w-md">
                                                    {msg.jsonData.status_jogador.nome}, {msg.jsonData.status_jogador.titulo.split("•")[1] || "Aventureiro"}
                                                </h3>
                                                <p className="text-stone-300 font-serif italic mb-6 text-sm md:text-base">
                                                    "Seus atributos foram definidos pelo destino."
                                                </p>
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 w-full max-w-lg">
                                                    {Object.entries(msg.jsonData.status_jogador.atributos).map(([key, val]) => (
                                                        <div key={key} className="bg-stone-900/80 p-2 md:p-3 rounded border border-yellow-900/40 shadow-lg backdrop-blur-sm">
                                                            <div className="text-yellow-700 text-[10px] md:text-xs uppercase tracking-[0.2em] font-bold mb-1">{key}</div>
                                                            <div className="text-stone-100 font-serif text-lg md:text-xl font-bold">{val}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                         )}
                                     </div>
                                 )}
                                 <div className="markdown-body font-serif leading-relaxed text-sm md:text-base">
                                     <ReactMarkdown>{msg.text}</ReactMarkdown>
                                 </div>
                                 
                                 {/* Render Form if present in this message and it's the latest */}
                                 {msg.role === 'model' && msg.form && messages[messages.length - 1].id === msg.id && (
                                     <DynamicForm 
                                        schema={msg.form} 
                                        onSubmit={handleFormSubmit}
                                        context={charCreationContext} 
                                     />
                                 )}
                             </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start animate-pulse">
                            <div className="bg-[#1e1c19] p-4 rounded-lg border border-[#3e352f] text-stone-500 font-serif italic text-sm">
                                O Mestre está pensando...
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-[#141210] border-t border-[#3e352f]">
                    {inputMode === 'rolagem' && currentRollRequest ? (
                         <div className="flex flex-col items-center gap-4 py-4 animate-fade-in">
                             <div className="text-yellow-600 font-fantasy text-lg uppercase tracking-widest text-center">
                                 {currentRollRequest.motivo}
                             </div>
                             <button 
                                onClick={() => handleRoll(Math.floor(Math.random() * 20) + 1, 20)}
                                className="w-24 h-24 bg-cover bg-center flex items-center justify-center text-3xl font-bold text-white shadow-lg hover:scale-110 transition-transform cursor-pointer rounded-full border-4 border-yellow-800 bg-stone-800"
                             >
                                🎲 d20
                             </button>
                             <p className="text-stone-500 text-xs">Clique para rolar</p>
                         </div>
                    ) : inputMode === 'botoes' ? (
                        <div className="flex flex-col gap-4 w-full">
                            <div className="flex flex-wrap gap-2 justify-center animate-fade-in">
                                {currentOptions.map((opt, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleSendMessage(opt.value)}
                                        className="bg-stone-800 hover:bg-stone-700 border border-stone-600 px-4 py-3 rounded text-left flex flex-col min-w-[200px] transition-all hover:-translate-y-0.5"
                                    >
                                        <span className="text-yellow-500 font-bold text-sm">{opt.label}</span>
                                        {opt.sub && <span className="text-stone-500 text-xs">{opt.sub}</span>}
                                    </button>
                                ))}
                            </div>
                            {allowFreeInput && renderInputArea()}
                        </div>
                    ) : inputMode === 'formulario' ? (
                        <div className="text-center text-stone-500 text-sm italic py-2">
                            Preencha o pergaminho acima para continuar...
                        </div>
                    ) : (
                        renderInputArea()
                    )}
                </div>
            </div>
        </div>
    );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);