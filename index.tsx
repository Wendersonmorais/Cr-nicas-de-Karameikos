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
  defaultValue?: string; 
  options?: string[];
  max_select?: number; 
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

interface Combatant {
  name: string;
  hp: number;
  max_hp: number;
  is_active: boolean;
  avatar?: string;
}

interface CombatState {
  round: number;
  turn_order: Combatant[];
}

interface InterfaceData {
  modo: "rolagem" | "botoes" | "formulario" | "texto_livre";
  permitir_input_livre?: boolean; 
  pedir_rolagem?: RollRequest;
  conteudo?: Option[] | FormSchema; 
}

// --- NEW: Strict Game Engine Event Structure ---
interface DiceRollData {
  roll_name: string;
  d20_result: number;
  modifier: number;
  proficiency: number;
  total_value: number;
  is_critical: boolean;
  is_success: boolean;
}

interface CombatHitData {
  target: string;
  damage: number;
  damage_type: string;
  is_critical: boolean;
}

interface ItemObtainedData {
  item_name: string;
  quantity: number;
  description: string;
  rarity?: "common" | "uncommon" | "rare" | "legendary";
  icon?: "weapon" | "potion" | "armor" | "misc";
}

interface GameEvent {
  type: "none" | "dice_roll" | "combat_hit" | "item_obtained";
  data: DiceRollData | CombatHitData | ItemObtainedData | any;
}

// The Root JSON Response from the AI
interface GameResponse {
  narrative: string;
  game_event?: GameEvent;
  status_jogador?: {
    nome: string;
    titulo: string;
    hp_atual: number;
    hp_max: number;
    local: string;
    missao?: string;
    inventario?: string[];
    atributos?: Record<string, string>; 
  };
  combat_state?: CombatState; // Added combat state
  quick_actions?: string[]; // Added quick actions
  update_avatar?: {
    trigger: boolean;
    visual_prompt?: string;
    style?: string;
  };
  interface?: InterfaceData;
  form?: FormSchema; // Optional shorthand for interface.conteudo if mode is form
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  imageUrl?: string;
  gameResponse?: GameResponse; // Store the full parsed response
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
  atributos?: Record<string, string>; 
  combat?: CombatState;
}

// --- Constants & Config ---
const MODEL_NAME = "gemini-2.5-flash";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image";
const TTS_MODEL_NAME = "gemini-2.5-flash-preview-tts";

const CLASS_GUIDE: Record<string, { main: string[], desc: string, optimal: Record<string, string> }> = {
    "guerreiro": {
        main: ["for"],
        desc: "Prioridade para dano corpo a corpo.",
        optimal: { for: "15", con: "14", des: "13", sab: "12", car: "10", int: "8" }
    },
    "ladino": {
        main: ["des"],
        desc: "Essencial para furtividade e ataque.",
        optimal: { des: "15", int: "14", con: "13", car: "12", sab: "10", for: "8" }
    },
    "mago": {
        main: ["int"],
        desc: "Essencial para lançar magias.",
        optimal: { int: "15", con: "14", des: "13", sab: "12", car: "10", for: "8" }
    },
    "clérigo": {
        main: ["sab"],
        desc: "Poder divino e magias.",
        optimal: { sab: "15", con: "14", for: "13", car: "12", int: "10", des: "8" }
    },
     "patrulheiro": {
        main: ["des", "sab"],
        desc: "Combate ágil e magias naturais.",
        optimal: { des: "15", sab: "14", con: "13", for: "12", int: "10", car: "8" }
    }
};

const SYSTEM_INSTRUCTION = `
**PERSONA:**
Você é um Motor de Jogo (Game Engine) e Mestre de RPG narrando Karameikos (D&D 5e).
Seu objetivo é gerar uma experiência imersiva e visual, separando estritamente a NARRATIVA da MECÂNICA.

**REGRA DE OURO (OUTPUT JSON):**
Você deve SEMPRE responder com um objeto JSON válido. NUNCA envie texto solto fora do JSON.

**ESTRUTURA OBRIGATÓRIA DO JSON:**
\`\`\`json
{
  "narrative": "A descrição literária da cena, diálogos e ambiente. Use Markdown para formatar (negrito, itálico).",
  
  "game_event": {
    "type": "none" | "dice_roll" | "combat_hit" | "item_obtained",
    "data": {
      // SE type="dice_roll":
      "roll_name": "Nome do Teste (ex: Furtividade)",
      "d20_result": 15,    // Valor cru do dado
      "modifier": 3,       // Modificador de atributo
      "proficiency": 2,    // Bônus de proficiência (se aplicável, ou 0)
      "total_value": 20,   // Soma final
      "is_critical": false, // True se d20_result == 20
      "is_success": true   // Baseado na DC oculta
      
      // SE type="combat_hit":
      // "target": "Goblin", "damage": 5, "damage_type": "Cortante", "is_critical": false
      
      // SE type="item_obtained":
      // "item_name": "Espada Curta", "quantity": 1, "description": "Lâmina enferrujada.", "rarity": "common", "icon": "weapon"
      // rarity options: common, uncommon, rare, legendary
      // icon options: weapon, potion, armor, misc
    }
  },

  "status_jogador": { 
      "nome": "Voron", 
      "titulo": "Guerreiro Nível 1",
      "hp_atual": 10, 
      "hp_max": 10, 
      "local": "Estrada de Threshold",
      "missao": "Sobreviver",
      "inventario": ["Corda", "Tocha"],
      "atributos": { "for": "15", "des": "12", ... } 
  },

  "combat_state": { // Opcional, envie APENAS se houver combate ativo
      "round": 1,
      "turn_order": [
          {"name": "Voron", "hp": 10, "max_hp": 10, "is_active": true, "avatar": ""},
          {"name": "Goblin", "hp": 7, "max_hp": 7, "is_active": false}
      ]
  },
  
  "quick_actions": ["Olhar ao redor", "Checar inventário", "Falar com NPC"], // NEW: 3-5 ações curtas contextuais

  "update_avatar": {
      "trigger": false, // True apenas se a aparência do personagem mudou drasticamente ou é o início
      "visual_prompt": "Prompt visual para gerar o retrato", 
      "style": "Dark Fantasy RPG Art"
  },

  "interface": {
      "modo": "botoes" | "formulario" | "texto_livre" | "rolagem",
      "permitir_input_livre": true,
      "conteudo": [ // Se modo="botoes"
          {"label": "Atacar", "value": "Eu ataco com minha espada", "sub": "Ação Padrão"},
          {"label": "Fugir", "value": "Tento fugir para a floresta"}
      ],
      // Se modo="formulario", preencher "conteudo" com o schema do formulário
  }
}
\`\`\`

**DIRETRIZES DE MESTRAGEM:**
1. **Juice & Feel**: Quando o jogador fizer uma ação que exija teste, GERE o teste você mesmo e retorne o resultado em \`game_event\`. Não peça para o jogador rolar se você pode simular a rolagem para dar agilidade.
2. **Matemática Transparente**: Em \`dice_roll\`, preencha os campos \`d20_result\`, \`modifier\` e \`proficiency\` corretamente.
3. **Criação de Personagem**: No início, use \`interface.modo = "formulario"\` com os schemas apropriados.
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
    gameResponse: {
        narrative: "Bem-vindo a Karameikos...",
        status_jogador: { nome: "Desconhecido", titulo: "Aventureiro", hp_atual: 10, hp_max: 10, local: "Estrada de Threshold", missao: "Sobreviver", inventario: [] },
        interface: { modo: "botoes", permitir_input_livre: true, conteudo: INITIAL_BUTTONS }
    }
}

// --- Components ---

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

// --- VISUAL CARDS (UI/UX) ---

// 1. Dice Result Card (Detailed Math)
const DiceResultCard = ({ data }: { data: DiceRollData }) => {
  if (!data) return null;

  const isCrit = data.is_critical;
  const isFail = data.d20_result === 1;
  
  let borderColor = data.is_success ? 'border-green-500/50' : 'border-red-600/50';
  let glowClass = '';
  let textColor = data.is_success ? 'text-green-400' : 'text-red-400';

  if (isCrit) {
      borderColor = 'border-amber-400';
      glowClass = 'shadow-[0_0_20px_rgba(251,191,36,0.2)] animate-pulse';
      textColor = 'text-amber-400';
  } else if (isFail) {
      borderColor = 'border-stone-600';
      glowClass = 'animate-shake grayscale';
      textColor = 'text-stone-500';
  }

  return (
    <div className={`relative w-full max-w-sm mx-auto my-4 bg-gray-900/90 backdrop-blur-sm rounded-lg border-2 ${borderColor} ${glowClass} p-4 animate-fade-in`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
        <span className="text-stone-400 text-xs font-bold uppercase tracking-widest">{data.roll_name}</span>
        {isCrit && <span className="text-amber-400 text-xs font-bold">CRÍTICO!</span>}
        {isFail && <span className="text-stone-500 text-xs font-bold">FALHA CRÍTICA</span>}
      </div>

      <div className="flex flex-col items-center">
        {/* Visual Dice */}
        <div className={`w-16 h-16 flex items-center justify-center rounded-full mb-2 shadow-inner border border-white/10 ${isCrit ? 'bg-amber-900/40' : 'bg-gray-800'}`}>
          <span className={`text-3xl font-black ${isCrit ? 'text-amber-100' : 'text-white'}`}>{data.d20_result}</span>
        </div>
        
        {/* Transparent Math */}
        <div className="flex gap-2 text-xs md:text-sm text-stone-500 font-mono mb-1">
           <span title="Dado">[{data.d20_result}]</span>
           <span title="Modificador">+ {data.modifier}</span>
           <span title="Proficiência">+ {data.proficiency}</span>
        </div>

        {/* Total */}
        <div className={`text-2xl font-bold ${textColor} drop-shadow-md`}>
          = {data.total_value}
        </div>
      </div>
    </div>
  );
};

// 2. Generic Event Card (Items, Damage, etc)
const GameEventCard = ({ event }: { event: GameEvent }) => {
    if (!event || event.type === 'none') return null;

    if (event.type === 'dice_roll') {
        return <DiceResultCard data={event.data as DiceRollData} />;
    }

    // Styles for other events
    let cardStyle = "border-stone-700 bg-stone-900/90";
    let icon = "✨";
    let title = "Evento";
    let mainValue = "";
    let subValue = "";

    if (event.type === 'combat_hit') {
        const data = event.data as CombatHitData;
        cardStyle = "border-red-900/60 bg-gradient-to-br from-red-950/90 to-black animate-shake";
        icon = "⚔️";
        title = "Dano Recebido";
        mainValue = `-${data.damage}`;
        subValue = `${data.damage_type} em ${data.target}`;
    } else if (event.type === 'item_obtained') {
        const data = event.data as ItemObtainedData;
        cardStyle = "border-yellow-700/50 bg-gradient-to-br from-yellow-950/40 to-black animate-fade-in";
        icon = "🎒";
        title = "Item Obtido";
        mainValue = `${data.quantity}x ${data.item_name}`;
        subValue = data.description;
    }

    return (
        <div className={`mt-4 mx-auto max-w-sm rounded-lg border-2 p-4 flex items-center justify-between shadow-xl backdrop-blur-sm ${cardStyle}`}>
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-70 mb-1 flex items-center gap-1">
                    {icon} {title}
                </span>
                <span className="text-xs text-stone-400 font-serif italic">
                    {subValue}
                </span>
            </div>
            <div className="flex flex-col items-end">
                <span className="text-xl font-fantasy font-bold text-stone-200">
                    {mainValue}
                </span>
            </div>
        </div>
    );
};

// 3. Combat Tracker Component
const CombatTracker = ({ combatState }: { combatState: CombatState }) => {
  if (!combatState || !combatState.turn_order) return null;

  return (
    <div className="w-full bg-black/80 backdrop-blur-md border-b border-yellow-900/30 p-3 flex gap-4 overflow-x-auto items-center animate-fade-in">
      <span className="text-xs font-bold text-red-500 uppercase tracking-widest whitespace-nowrap mr-2">
        Turno {combatState.round}
      </span>
      
      {combatState.turn_order.map((char, idx) => (
        <div 
          key={idx}
          className={`
            relative flex flex-col items-center min-w-[60px] transition-all duration-300
            ${char.is_active ? 'scale-110 opacity-100' : 'opacity-60 grayscale'}
          `}
        >
          {/* Avatar com Borda de Destaque se for o Turno Ativo */}
          <div className={`w-10 h-10 rounded-full border-2 overflow-hidden ${char.is_active ? 'border-amber-500 shadow-[0_0_10px_#f59e0b]' : 'border-gray-600'}`}>
             {char.avatar ? (
                <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
             ) : (
                <div className="w-full h-full bg-stone-800 flex items-center justify-center text-[8px]">{char.name.substring(0,2)}</div>
             )}
          </div>
          
          {/* Barra de Vida Miniatura */}
          <div className="w-full h-1.5 bg-gray-700 mt-1 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${char.hp < char.max_hp * 0.3 ? 'bg-red-500' : 'bg-green-500'}`} 
              style={{ width: `${Math.max(0, Math.min(100, (char.hp / char.max_hp) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// 4. Loot Toast Component (Notification)
const LootToast = ({ item }: { item: ItemObtainedData }) => {
  if (!item) return null;

  const colors: Record<string, string> = {
    common: "border-gray-500 shadow-gray-500/10",
    uncommon: "border-green-500 shadow-green-500/20",
    rare: "border-blue-500 shadow-blue-500/20",
    legendary: "border-amber-500 shadow-amber-500/40"
  };

  const theme = colors[item.rarity || 'common'] || colors.common;

  // Simple icon mapping logic
  const getIcon = () => {
    if (item.icon) {
        switch(item.icon) {
            case 'potion': return '🧪';
            case 'weapon': return '⚔️';
            case 'armor': return '🛡️';
            case 'misc': return '🎒';
        }
    }
    // Fallback based on name keywords if no icon provided
    const name = item.item_name.toLowerCase();
    if (name.includes('poção') || name.includes('elixir')) return '🧪';
    if (name.includes('espada') || name.includes('machado') || name.includes('arco')) return '⚔️';
    if (name.includes('armadura') || name.includes('escudo') || name.includes('manto')) return '🛡️';
    return '🎒';
  };

  return (
    <div className={`
      absolute top-20 right-4 z-50 flex items-center gap-3 p-3 rounded-lg 
      bg-gray-900/90 border-l-4 ${theme} shadow-lg backdrop-blur-sm
      animate-in slide-in-from-right duration-500
    `}>
      <div className="w-10 h-10 bg-black/40 rounded flex items-center justify-center text-2xl">
        {getIcon()}
      </div>
      
      <div>
        <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Item Obtido</p>
        <p className="font-bold text-white text-sm">{item.item_name}</p>
      </div>
    </div>
  );
};

// 5. Quick Actions Component
const QuickActions = ({ actions, onActionClick }: { actions: string[], onActionClick: (action: string) => void }) => {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex gap-2 mb-2 px-1 overflow-x-auto pb-2 w-full">
      {actions.map((actionText, idx) => (
        <button
          key={idx}
          onClick={() => onActionClick(actionText)}
          className="
            whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium
            bg-stone-800 text-stone-300 border border-stone-600
            hover:bg-stone-700 hover:text-white hover:border-yellow-600
            transition-all active:scale-95 shadow-sm
          "
        >
          {actionText}
        </button>
      ))}
    </div>
  );
};

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

// Manual PCM Decoder to fix TTS audio error
async function decodePCM(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const byteLength = data.length;
  // Ensure buffer length is even for Int16Array
  if (byteLength % 2 !== 0) {
      const newData = new Uint8Array(byteLength + 1);
      newData.set(data);
      data = newData;
  }
  
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
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

// --- Dynamic Form Component ---
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

    let activeSchema = schema || {};
    const fields = Array.isArray(activeSchema.fields) ? activeSchema.fields : [];
    const hasGenericFields = fields.some((f: any) => f.label?.toLowerCase().includes("campo") || f.label?.toLowerCase().includes("field"));
    const isEmpty = fields.length === 0;

    if (isEmpty || hasGenericFields) {
        activeSchema = DEFAULT_CHAR_SHEET;
    }
    
    const safeFields = activeSchema.fields;
    const isAttributeAllocation = activeSchema.titulo?.toLowerCase().includes("alocação") || 
                                  activeSchema.titulo?.toLowerCase().includes("atributos");

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

    const getAttributeConfig = (fieldId: string) => {
        if (!isAttributeAllocation || !context?.userClass) return { placeholder: undefined, isMain: false };
        
        const classKey = Object.keys(CLASS_GUIDE).find(k => 
            context.userClass!.toLowerCase().includes(k)
        );
        
        if (!classKey) return { placeholder: "Valor...", isMain: false };
        
        const guide = CLASS_GUIDE[classKey];
        const isMain = guide.main.includes(fieldId);
        const isStandardArray = context.method?.toLowerCase().includes("padrão") || context.method?.toLowerCase().includes("standard");

        let placeholder = "Valor...";

        if (isStandardArray) {
            placeholder = `Sugerido: ${guide.optimal[fieldId] || "8"}`;
        } else {
            if (isMain) {
                placeholder = "⭐ Atributo Principal (Prioridade Máxima)";
            } else if (fieldId === "con") {
                placeholder = "Recomendado para Vida";
            } else {
                placeholder = "Valor secundário";
            }
        }

        return { placeholder, isMain };
    };

    return (
        <div className="mt-8 mx-auto max-w-lg relative group animate-fade-in">
             <div className="absolute -inset-0.5 bg-gradient-to-b from-yellow-800 to-yellow-950 rounded-lg opacity-50 blur-[2px]"></div>
             
             <div className="relative bg-[#1a1816] border border-yellow-900/60 p-6 rounded-lg shadow-2xl">
                 <div className="mb-6 text-center border-b border-yellow-900/30 pb-4">
                     <h3 className="text-yellow-600 font-fantasy text-xl tracking-[0.2em] uppercase drop-shadow-md">
                        {activeSchema.titulo || "Ficha de Personagem"}
                     </h3>
                 </div>

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
                        const { placeholder: smartPlaceholder, isMain } = getAttributeConfig(field.id);
                        
                        return (
                        <div key={field.id || idx} className="flex flex-col gap-2">
                            <label className="text-stone-400 text-xs font-bold uppercase tracking-widest flex justify-between items-center">
                                <span className={isMain ? "text-amber-500" : ""}>{field.label}</span>
                                {isMain && <span className="text-[10px] text-amber-600 ml-2">★ RECOMENDADO</span>}
                                {field.max_select && <span className="text-[10px] text-stone-600">(Max: {field.max_select})</span>}
                            </label>
                            
                            {field.type === 'text' && (
                                <input 
                                    type="text"
                                    placeholder={smartPlaceholder || field.placeholder}
                                    value={formData[field.id] || ''}
                                    onChange={(e) => handleInputChange(field.id, e.target.value)}
                                    className={`bg-black/30 border rounded p-3 text-stone-200 outline-none font-serif w-full placeholder-stone-600 focus:placeholder-stone-500/50
                                        ${isMain 
                                            ? 'border-amber-500 ring-1 ring-amber-500/50 bg-amber-900/10' 
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

                             {field.id === 'atributos' && formData[field.id] && (
                                <div className="animate-fade-in mt-3 space-y-3">
                                    {formData[field.id].toString().toLowerCase().includes('rolagem') && (
                                        <div className="p-3 bg-indigo-900/40 border border-indigo-500/30 rounded text-xs text-indigo-200 font-serif shadow-inner">
                                            <p className="font-bold text-indigo-100 mb-1 flex items-center gap-2">
                                                <span className="text-lg">🎲</span> O Destino Decide
                                            </p>
                                            <p>Ao confirmar, o Mestre rolará 4d6 (descartando o menor) 6 vezes para você.</p>
                                        </div>
                                    )}
                                    
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
    const [allowFreeInput, setAllowFreeInput] = useState(true); 
    const [currentOptions, setCurrentOptions] = useState<Option[]>(INITIAL_BUTTONS);
    const [currentFormSchema, setCurrentFormSchema] = useState<FormSchema | null>(null);
    const [lootNotification, setLootNotification] = useState<ItemObtainedData | null>(null);
    const [quickActions, setQuickActions] = useState<string[]>([]);
    
    // Floating Text State (Damage/Heal numbers)
    const [floatingTexts, setFloatingTexts] = useState<{id: number, text: string, color: string}[]>([]);
    const prevHpRef = useRef(status.hp_atual);

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

    // Handle Floating Damage Text Logic
    useEffect(() => {
        const diff = status.hp_atual - prevHpRef.current;
        if (diff !== 0) {
             const id = Date.now();
             const text = diff > 0 ? `+${diff}` : `${diff}`;
             const color = diff > 0 ? 'text-green-400' : 'text-red-500';
             setFloatingTexts(prev => [...prev, { id, text, color }]);
             // Remove text after animation completes
             setTimeout(() => setFloatingTexts(prev => prev.filter(t => t.id !== id)), 2000);
        }
        prevHpRef.current = status.hp_atual;
    }, [status.hp_atual]);

    // Initialize Audio Context on user interaction (handled in toggle)
    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume;
        }
    }, [volume]);

    const playTTS = async (text: string) => {
        if (!isAudioEnabled) return;

        try {
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
            
            if (!text) {
                setIsSpeaking(false);
                return;
            }

            const response = await ai.models.generateContent({
                model: TTS_MODEL_NAME,
                contents: [{ parts: [{ text: text }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, 
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current && gainNodeRef.current) {
                const audioBuffer = await decodePCM(
                    decode(base64Audio),
                    audioContextRef.current,
                    24000,
                    1
                );
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

    const handleSendMessage = async (text: string) => {
        if (!text || !text.trim()) return;

        const userMsg: Message = { id: Date.now().toString(), role: "user", text };
        setMessages(prev => [...prev, userMsg]);
        setInputText("");
        setIsLoading(true);
        setInputMode("texto_livre"); 

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const history = messages.map(m => {
               return { role: m.role, parts: [{ text: m.text }] };
            });

            history.push({ role: "user", parts: [{ text: text }] });

            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: history,
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    responseMimeType: "application/json" // FORCE JSON RESPONSE
                }
            });

            const responseText = response.text || "{}";
            
            // --- STRICT JSON PARSING ---
            let gameResponse: GameResponse | null = null;
            let narrative = "O silêncio responde...";
            
            try {
                // Try to clean markdown code blocks if present
                const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
                gameResponse = JSON.parse(cleanJson) as GameResponse;
                narrative = gameResponse.narrative || responseText;
            } catch (e) {
                console.error("JSON Parsing failed. Fallback to raw text.", e);
                narrative = responseText;
            }

            // --- PROCESS GAME STATE ---
            let finalOptions: Option[] = [];
            let finalForm: FormSchema | null = null;
            let nextMode: "texto_livre" | "botoes" | "rolagem" | "formulario" = "texto_livre";
            let nextAllowInput = false;
            let imageUrl: string | undefined = undefined;

            if (gameResponse) {
                // Status Update
                if (gameResponse.status_jogador) {
                    setStatus(prev => ({ 
                        ...prev, 
                        ...gameResponse!.status_jogador, 
                        combat: gameResponse!.combat_state 
                    }));
                } else if (gameResponse.combat_state) {
                    setStatus(prev => ({ ...prev, combat: gameResponse!.combat_state }));
                }

                // Loot Notification Trigger
                if (gameResponse.game_event?.type === 'item_obtained') {
                    setLootNotification(gameResponse.game_event.data as ItemObtainedData);
                    // Dismiss after 4 seconds
                    setTimeout(() => setLootNotification(null), 4000);
                }
                
                // Quick Actions Update
                if (gameResponse.quick_actions) {
                    setQuickActions(gameResponse.quick_actions);
                } else {
                    setQuickActions([]);
                }

                // Visual Update
                if (gameResponse.update_avatar?.trigger && gameResponse.update_avatar.visual_prompt) {
                     const avatarPrompt = "Fantasy RPG Portrait, " + gameResponse.update_avatar.visual_prompt;
                     try {
                        const avatarRes = await ai.models.generateContent({
                            model: IMAGE_MODEL_NAME,
                            contents: { parts: [{ text: avatarPrompt }] }
                        });
                        const part = avatarRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                        if (part) {
                            setStatus(prev => ({ ...prev, avatarUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }));
                        }
                     } catch(e) { console.error("Avatar Gen Error", e); }
                }

                // Scene Visual Hook (Heuristic: triggers on new location or specific keywords)
                if (gameResponse.narrative.length > 50 && Math.random() > 0.7) {
                     const scenePrompt = "Dark fantasy rpg landscape, " + gameResponse.narrative.substring(0, 100);
                     try {
                        const imgRes = await ai.models.generateContent({
                            model: IMAGE_MODEL_NAME,
                            contents: { parts: [{ text: scenePrompt }] }
                        });
                        const part = imgRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                        if (part) {
                            imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        }
                     } catch (e) { console.error("Scene Gen Error", e); }
                }

                // Interface Update
                if (gameResponse.interface) {
                    nextMode = gameResponse.interface.modo;
                    nextAllowInput = !!gameResponse.interface.permitir_input_livre;
                    
                    if (nextMode === 'botoes') {
                        if (Array.isArray(gameResponse.interface.conteudo) && gameResponse.interface.conteudo.length > 0) {
                            finalOptions = gameResponse.interface.conteudo as Option[];
                        } else {
                            finalOptions = [{ label: "Continuar", value: "Continuar" }];
                        }
                    } else if (nextMode === 'formulario' && gameResponse.interface.conteudo) {
                        // Assuming the content passed for form is the schema
                        finalForm = gameResponse.interface.conteudo as unknown as FormSchema;
                    }
                }
            }

            const modelMsg: Message = {
                id: Date.now().toString(),
                role: "model",
                text: narrative,
                gameResponse: gameResponse || undefined,
                options: finalOptions,
                imageUrl: imageUrl,
                form: finalForm || undefined
            };

            setMessages(prev => [...prev, modelMsg]);
            setInputMode(nextMode);
            setAllowFreeInput(nextAllowInput);
            
            playTTS(narrative);

            if (nextMode === 'botoes') {
                setCurrentOptions(finalOptions);
            } else {
                setCurrentOptions([]);
            }

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

    // Generic handler that sends system notes
    const handleSystemAction = (text: string) => {
        handleSendMessage(text);
    };

    const handleFormSubmit = (values: Record<string, string | string[]>) => {
        if (values.classe && values.atributos) {
            setCharCreationContext({
                userClass: values.classe as string,
                method: values.atributos as string
            });
        }
        
        const valueString = JSON.stringify(values);
        handleSendMessage(`[SISTEMA: Ficha preenchida: ${valueString}]`);
    };
    
    // Logic for "Contextual Inventory" (Inspecting items triggers AI description)
    const handleInspect = (item: string) => {
        handleSendMessage(`[SISTEMA: O jogador examina o item "${item}". Descreva-o sensorialmente considerando o local atual.]`);
    };

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
                         {/* Floating Damage Text Overlay */}
                         {floatingTexts.map(ft => (
                             <div key={ft.id} className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl font-bold font-fantasy drop-shadow-md pointer-events-none animate-float-up ${ft.color}`} style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
                                 {ft.text}
                             </div>
                         ))}
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

                     {/* INVENTORY SECTION */}
                     <div className="bg-[#1e1c19] p-3 rounded border border-[#3e352f]">
                         <h4 className="text-xs uppercase font-bold text-stone-500 mb-2 flex justify-between">
                            <span>Mochila</span>
                            <span className="text-[10px] text-stone-600 font-normal normal-case italic">(Clique para examinar)</span>
                         </h4>
                         <div className="flex flex-wrap gap-2">
                             {status.inventario?.map((item, i) => (
                                 <button 
                                    key={i} 
                                    onClick={() => handleInspect(item)} 
                                    className="text-xs bg-black/40 border border-stone-700 px-2 py-1 rounded text-stone-300 hover:border-yellow-700 hover:text-yellow-200 transition-all cursor-pointer" 
                                    title="Inspecionar"
                                 >
                                     {item}
                                 </button>
                             ))}
                             {(!status.inventario || status.inventario.length === 0) && <span className="text-xs text-stone-600 italic">Vazio</span>}
                         </div>
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
                {/* Loot Notification (Toast) */}
                {lootNotification && <LootToast item={lootNotification} />}

                {/* Combat Tracker (Shown if combat state exists) */}
                {status.combat && <CombatTracker combatState={status.combat} />}

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
                                         {msg.gameResponse?.status_jogador?.atributos && (
                                            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center p-6 text-center backdrop-blur-[2px] transition-opacity duration-700 opacity-0 animate-fade-in group-hover:opacity-100">
                                                <h3 className="font-fantasy text-2xl md:text-4xl text-yellow-500 mb-4 drop-shadow-lg border-b border-yellow-800/50 pb-2 w-full max-w-md">
                                                    {msg.gameResponse.status_jogador.nome}, {msg.gameResponse.status_jogador.titulo.split("•")[1] || "Aventureiro"}
                                                </h3>
                                                <p className="text-stone-300 font-serif italic mb-6 text-sm md:text-base">
                                                    "Seus atributos foram definidos pelo destino."
                                                </p>
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 w-full max-w-lg">
                                                    {Object.entries(msg.gameResponse.status_jogador.atributos).map(([key, val]) => (
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

                                 {/* --- GAME ENGINE VISUAL EVENTS --- */}
                                 {msg.role === 'model' && msg.gameResponse?.game_event && (
                                     <GameEventCard event={msg.gameResponse.game_event} />
                                 )}
                                 
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
                    {/* Render Quick Actions here if available */}
                    <QuickActions actions={quickActions} onActionClick={handleSendMessage} />
                    
                    {inputMode === 'rolagem' ? (
                        <div className="flex flex-col items-center gap-4 py-4 animate-fade-in">
                            <div className="text-yellow-600 font-fantasy text-lg uppercase tracking-widest text-center">
                                Rolagem Necessária
                            </div>
                             {/* Auto-roll handled by engine mostly, but kept for manual overrides if needed */}
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