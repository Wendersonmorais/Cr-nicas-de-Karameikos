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
}

// --- Constants & Config ---
const MODEL_NAME = "gemini-2.5-flash";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";

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
      "inventario": ["Item 1", "Item 2"]
  },
  "update_avatar": {
      "trigger": Boolean,  // True se o visual do personagem mudou ou foi criado
      "visual_prompt": "String para gerar imagem do rosto (opcional)", 
      "style": "Dark Fantasy RPG Art"
  },
  "interface": {
      "modo": "String ('rolagem' | 'botoes' | 'formulario' | 'texto_livre')",
      "pedir_rolagem": { // PREENCHER SE MODO == 'rolagem'
          "dado": "d20",
          "motivo": "Teste de Furtividade",
          "dificuldade_oculta": 12
      },
      "conteudo": [ ... ] // Lista de opções (se botoes) ou Schema do formulário (se formulario)
  }
}
\`\`\`

**REGRAS DE INTERFACE E DADOS (CRÍTICO):**
1. **AVATAR DINÂMICO:**
   - O campo \`nome\` começa como "Desconhecido".
   - SE o jogador se apresentar ou o narrador descobrir o nome, ATUALIZE \`status_jogador.nome\` imediatamente no JSON.
   - Para gerar o avatar, use o campo \`update_avatar\` no JSON.
2. **SISTEMA DE ROLAGEM (STOP & WAIT):**
   - Você **NÃO** rola dados para testes do jogador. Você **SOLICITA** rolagens.
   - Quando uma ação for incerta (ataque, perícia):
     1. Narre a tensão e preparação.
     2. Defina \`interface.modo = "rolagem"\`.
     3. Preencha \`interface.pedir_rolagem\` com o dado necessário.
     4. PARE a resposta. Aguarde o input do sistema (o jogador clicará no dado e enviará o resultado).
   - **RETORNO DO SISTEMA:** Quando o jogador rolar, você receberá uma mensagem EXATA: \`[SISTEMA: O Jogador rolou d20 e obteve: 15]\`. Use isso para narrar a consequência.
3. **CRIAÇÃO DE PERSONAGEM (FORMULÁRIO):**
   - Ao escolher arquétipo, use \`interface.modo = "formulario"\`.
   - Coloque o schema do formulário em \`interface.conteudo\`.
   - **Schema Obrigatório do Formulário:**
     - **Nome**: Texto (Se o jogador digitar "Gerar com IA", você deve inventar um nome adequado).
     - **Raça**: Dropdown com as principais raças de Mystara (Humano Traladarano, Humano Thyatiano, Elfo, Anão, Halfling).
     - **Classe**: Dropdown com as classes básicas (Guerreiro, Ladino, Mago, Clérigo, Patrulheiro, Paladino).
     - **Atributos**: Dropdown com ["Arranjo Padrão (15, 14, 13, 12, 10, 8)", "Compra de Pontos (27 pts)", "Rolagem (4d6 drop lowest)"].
     - **Talento**: Dropdown com ["Sangue Traladarano (Vantagem vs Veneno)", "Disciplina Thyatiana (+1 Iniciativa)", "Erudito de Glantri (Arcanismo)", "Rato de Specularum (Furtividade Urbano)"].
     - **Equipamento**: Radio com ["Pacote de Aventureiro", "Pacote de Explorador", "Pacote de Diplomata"].

**SISTEMA DE SAVE/LOAD:**
Se solicitado "Save", gere um bloco de texto visível com \`[CHECKPOINT_KARAMEIKOS]\`.

**SISTEMA DE RETRATO & CENAS:**
Para gerar imagens de cenário, use o bloco \`--- [CENA VISUAL SUGERIDA] ---\` dentro da narrativa.
`;

const INITIAL_BUTTONS: Option[] = [
  { label: "Legionário Thyatiano", sub: "Guerreiro Humano", value: "Eu sou um Legionário Thyatiano (Guerreiro Humano). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "\"Raposa\" Traladarana", sub: "Ladino Humano", value: "Eu sou uma 'Raposa' Traladarana (Ladino Humano). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "Erudito de Glantri", sub: "Mago Elfo", value: "Eu sou um Erudito de Glantri (Mago Elfo). Apresente o FORMULÁRIO para eu preencher minha ficha agora." },
  { label: "✨ Criar meu próprio", sub: "Personalizado", value: "Gostaria de criar meu próprio personagem. Apresente o FORMULÁRIO completo para eu preencher os detalhes agora." },
];

const INITIAL_MESSAGE: Message = {
    id: 'intro',
    role: 'model',
    text: "Bem-vindo a Karameikos. A névoa cobre as montanhas escarpadas ao norte, enquanto as tensões entre os nativos Traladaranos e os conquistadores Thyatianos fervem nas cidades. Você se encontra na estrada perto de Threshold. O vento uiva, carregando o cheiro de chuva e... algo mais metálico.\n\nAntes de começarmos, quem é você?",
    options: INITIAL_BUTTONS,
    jsonData: {
        status_jogador: { nome: "Desconhecido", titulo: "Aventureiro", hp_atual: 10, hp_max: 10, local: "Estrada de Threshold", missao: "Sobreviver", inventario: [] },
        interface: { modo: "botoes", conteudo: INITIAL_BUTTONS }
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

const getFieldIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes("nome")) return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-yellow-600">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>
    );
    if (l.includes("raça") || l.includes("origem")) return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-yellow-600">
             <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
        </svg>
    );
    if (l.includes("classe") || l.includes("profissão")) return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-yellow-600">
             <path d="M14.5 17.5L17 20l-2.5 2.5L12 20l2.5-2.5zm-5 0L7 20l2.5 2.5L12 20l-2.5-2.5zm5.9-6.1l2.8-2.8c.4-.4.4-1 0-1.4l-2.8-2.8c-.4-.4-1-.4-1.4 0l-2.8 2.8 4.2 4.2zm-7 0l-2.8-2.8c-.4-.4-.4-1 0-1.4l2.8-2.8c.4-.4 1-.4 1.4 0l2.8 2.8-4.2 4.2zM12 2l2.1 2.1c.4.4.4 1 0 1.4L12 7.6 9.9 5.5c-.4-.4-.4-1 0-1.4L12 2z"/>
        </svg>
    );
    if (l.includes("atributo") || l.includes("habilidade")) return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-yellow-600">
             <path d="M19.07 4.93L17.66 3.52C17.27 3.13 16.63 3.13 16.24 3.52L12 7.76 7.76 3.52C7.37 3.13 6.73 3.13 6.34 3.52L4.93 4.93C4.54 5.32 4.54 5.96 4.93 6.35L9.17 10.59 4.93 14.83C4.54 15.22 4.54 15.86 4.93 16.25L6.34 17.66C6.73 18.05 7.37 18.05 7.76 17.66L12 13.41 16.24 17.66C16.63 18.05 17.27 18.05 17.66 17.66L19.07 16.25C19.46 15.86 19.46 15.22 19.07 14.83L14.83 10.59 19.07 6.35C19.46 5.96 19.46 5.32 19.07 4.93Z" />
        </svg>
    );
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-yellow-600">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
        </svg>
    );
}

// --- Dynamic Form Component (Restored & Fixed) ---

const DynamicForm = ({ 
    schema, 
    onSubmit 
}: { 
    schema: any, 
    onSubmit: (values: Record<string, string | string[]>) => void 
}) => {
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Safety checks for schema rendering
    const safeSchema = schema || {};
    const safeFields: FormField[] = Array.isArray(safeSchema) 
        ? safeSchema 
        : (Array.isArray(safeSchema.fields) ? safeSchema.fields : []);

    const safeTitle = safeSchema.titulo || "Ficha de Personagem";

    if (safeFields.length === 0) {
        return (
            <div className="p-4 bg-red-900/20 border border-red-800 rounded text-red-400 text-xs font-mono text-center">
                [ERRO ARCANO] O pergaminho está em branco (JSON Inválido).
                <button 
                    onClick={() => onSubmit({ erro: "O formulário veio vazio. Mestre, gere novamente por favor." })}
                    className="block mx-auto mt-2 text-stone-300 underline hover:text-white cursor-pointer"
                >
                    Pedir ao Mestre novamente
                </button>
            </div>
        );
    }

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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        onSubmit(formData);
    };

    return (
        <div className="mt-8 mx-auto w-full max-w-lg bg-[#181614] border-2 border-double border-yellow-900/40 rounded-sm p-8 shadow-[0_10px_40px_rgba(0,0,0,0.5)] animate-fade-in relative overflow-hidden group">
             
             {/* Background Texture Effect */}
             <div className="absolute inset-0 bg-gradient-to-b from-[#25211e] to-[#161412] opacity-80 pointer-events-none"></div>
             
             {/* Corner Ornaments */}
             <CornerDecoration className="top-0 left-0" />
             <CornerDecoration className="top-0 right-0 rotate-90" />
             <CornerDecoration className="bottom-0 right-0 rotate-180" />
             <CornerDecoration className="bottom-0 left-0 -rotate-90" />

             {/* Content */}
             <div className="relative z-10">
                 <div className="mb-4 text-center">
                     <h3 className="text-yellow-600 font-fantasy text-xl tracking-widest uppercase">
                        {safeTitle}
                     </h3>
                     <DividerDecoration />
                 </div>

                 <form onSubmit={handleSubmit} className="space-y-6">
                    {(safeFields || []).map((field, index) => {
                        // Safe ID and Label generation
                        const fieldId = field.id || `field_${index}`;
                        const fieldLabel = field.label || `Campo ${index + 1}`;
                        
                        // Check for Name field safely
                        const isNameField = (typeof fieldId === 'string' && fieldId.toLowerCase().includes('nome')) || 
                                            (typeof fieldLabel === 'string' && fieldLabel.toLowerCase().includes('nome'));

                        return (
                        <div key={fieldId} className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-stone-400 text-xs font-bold uppercase tracking-wider pl-1">
                                {getFieldIcon(fieldLabel)}
                                {fieldLabel}
                                {field.max_select && <span className="text-[10px] text-stone-600 ml-auto">(Max: {field.max_select})</span>}
                            </label>
                            
                            {field.type === 'text' && (
                                <div className="flex gap-2 relative">
                                    <input 
                                        type="text"
                                        placeholder={field.placeholder}
                                        value={formData[fieldId] || ''}
                                        onChange={(e) => handleInputChange(fieldId, e.target.value)}
                                        className="bg-[#0c0b0a] border-b-2 border-stone-800 rounded-t p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif placeholder-stone-700 w-full transition-colors focus:bg-[#1a1816]"
                                    />
                                    {isNameField && (
                                        <button
                                            type="button"
                                            onClick={() => handleInputChange(fieldId, "Gerar com IA")}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-gradient-to-r from-yellow-900/40 to-yellow-800/40 border border-yellow-700/50 rounded text-yellow-500 text-[10px] font-bold hover:from-yellow-900/60 hover:to-yellow-800/60 transition-all uppercase tracking-wider flex items-center gap-1 shadow-sm"
                                            title="A IA escolherá um nome temático para você"
                                        >
                                            <span>✨</span> IA
                                        </button>
                                    )}
                                </div>
                            )}

                            {field.type === 'select' && field.options && (
                                 <div className="relative">
                                     <select
                                        value={formData[fieldId] || ''}
                                        onChange={(e) => handleInputChange(fieldId, e.target.value)}
                                        className="appearance-none bg-[#0c0b0a] border-b-2 border-stone-800 rounded-t p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif w-full cursor-pointer hover:bg-[#1a1816] transition-colors"
                                     >
                                        <option value="">-- Selecione --</option>
                                        {field.options.map((opt, idx) => (
                                            <option key={idx} value={opt}>{opt}</option>
                                        ))}
                                     </select>
                                     <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-yellow-700">
                                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                                     </div>
                                 </div>
                            )}

                            {field.type === 'radio' && field.options && (
                                <div className="flex flex-col gap-2 bg-[#0c0b0a]/50 p-3 rounded border border-stone-800">
                                    {field.options.map((opt, idx) => (
                                        <label key={idx} className="flex items-center gap-3 cursor-pointer group hover:bg-stone-800/50 p-1 rounded transition-colors">
                                            <div className={`w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center group-hover:border-yellow-600 transition-colors ${formData[fieldId] === opt ? 'border-yellow-600' : ''}`}>
                                                {formData[fieldId] === opt && <div className="w-2 h-2 bg-yellow-600 rounded-full shadow-[0_0_5px_rgba(202,138,4,0.8)]"></div>}
                                            </div>
                                            <input 
                                                type="radio" 
                                                name={fieldId} 
                                                value={opt}
                                                checked={formData[fieldId] === opt}
                                                onChange={() => handleInputChange(fieldId, opt)}
                                                className="hidden"
                                            />
                                            <span className={`text-sm font-serif ${formData[fieldId] === opt ? 'text-yellow-500 italic' : 'text-stone-500 group-hover:text-stone-300'}`}>{opt}</span>
                                        </label>
                                    ))}
                                </div>
                            )}

                            {field.type === 'checkbox' && field.options && (
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-[#0c0b0a]/50 p-3 rounded border border-stone-800">
                                    {field.options.map((opt, idx) => {
                                        const isSelected = (formData[fieldId] || []).includes(opt);
                                        return (
                                            <label key={idx} className={`flex items-center gap-3 cursor-pointer group p-2 rounded transition-all border ${isSelected ? 'bg-yellow-900/20 border-yellow-800/50' : 'border-transparent hover:bg-stone-800/50'}`}>
                                                <div className={`w-4 h-4 rounded border border-stone-600 flex items-center justify-center transition-colors ${isSelected ? 'bg-yellow-900 border-yellow-700' : ''}`}>
                                                    {isSelected && <span className="text-xs text-yellow-200">✓</span>}
                                                </div>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected}
                                                    onChange={() => handleCheckboxChange(fieldId, opt, field.max_select || 99)}
                                                    className="hidden"
                                                />
                                                <span className={`text-sm font-serif ${isSelected ? 'text-yellow-200' : 'text-stone-500'}`}>{opt}</span>
                                            </label>
                                        );
                                    })}
                                 </div>
                            )}
                        </div>
                        );
                    })}

                    <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full mt-6 bg-gradient-to-r from-yellow-900 to-yellow-800 hover:from-yellow-800 hover:to-yellow-700 border-t border-yellow-600/30 text-yellow-100 font-bold py-3 rounded-sm uppercase tracking-widest transition-all hover:shadow-[0_0_15px_rgba(202,138,4,0.3)] transform hover:-translate-y-0.5 relative overflow-hidden group"
                    >
                        <span className="relative z-10 flex items-center justify-center gap-2">
                             {isSubmitting ? "Selando Contrato..." : "Confirmar Destino"}
                             {!isSubmitting && <span className="text-lg">✒️</span>}
                        </span>
                        <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </button>
                 </form>
             </div>
        </div>
    );
}