import React, { useState } from 'react';

interface FormField {
    id: string;
    label?: string;
    type: 'text' | 'select' | 'radio' | 'checkbox';
    placeholder?: string;
    options?: string[];
    max_select?: number;
}

// --- DYNAMIC FORM COMPONENT ---

export const DynamicForm = ({ 
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
        <div className="mt-6 bg-[#1a1816] border border-yellow-900/30 rounded-sm p-5 shadow-2xl animate-fade-in relative overflow-hidden">
             {/* Decorative Header */}
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-800 to-transparent"></div>
             <div className="mb-6 text-center">
                 <h3 className="text-yellow-600 font-fantasy text-lg tracking-widest uppercase border-b border-stone-800 pb-2 inline-block px-8">
                    {safeTitle}
                 </h3>
             </div>

             <form onSubmit={handleSubmit} className="space-y-6">
                {(safeFields || []).map((field, index) => {
                    const fieldId = field.id || `field_${index}`;
                    const fieldLabel = field.label || `Campo ${index + 1}`;
                    const isNameField = (fieldId && typeof fieldId === 'string' && fieldId.toLowerCase().includes('nome')) || 
                                        (fieldLabel && typeof fieldLabel === 'string' && fieldLabel.toLowerCase().includes('nome'));

                    return (
                    <div key={fieldId} className="flex flex-col gap-2">
                        <label className="text-stone-400 text-sm font-bold uppercase tracking-wider">
                            {fieldLabel}
                            {field.max_select && <span className="text-[10px] text-stone-600 ml-2">(Max: {field.max_select})</span>}
                        </label>
                        
                        {field.type === 'text' && (
                            <div className="flex gap-2">
                                <input 
                                    type="text"
                                    placeholder={field.placeholder}
                                    value={formData[fieldId] || ''}
                                    onChange={(e) => handleInputChange(fieldId, e.target.value)}
                                    className="bg-stone-900/50 border border-stone-700 rounded p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif placeholder-stone-600 w-full"
                                />
                                {isNameField && (
                                    <button
                                        type="button"
                                        onClick={() => handleInputChange(fieldId, "Gerar com IA")}
                                        className="px-3 py-2 bg-yellow-900/20 border border-yellow-700/50 rounded text-yellow-500 text-[10px] font-bold hover:bg-yellow-900/40 transition-colors uppercase tracking-wider whitespace-nowrap flex items-center gap-1"
                                        title="A IA escolherá um nome temático para você"
                                    >
                                        <span>✨</span> Gerar IA
                                    </button>
                                )}
                            </div>
                        )}

                        {field.type === 'select' && field.options && (
                             <select
                                value={formData[fieldId] || ''}
                                onChange={(e) => handleInputChange(fieldId, e.target.value)}
                                className="bg-stone-900/50 border border-stone-700 rounded p-3 text-stone-200 focus:border-yellow-700 outline-none font-serif w-full"
                             >
                                <option value="">Selecione...</option>
                                {field.options.map((opt, idx) => (
                                    <option key={idx} value={opt}>{opt}</option>
                                ))}
                             </select>
                        )}

                        {field.type === 'radio' && field.options && (
                            <div className="flex flex-col gap-2 pl-2">
                                {field.options.map((opt, idx) => (
                                    <label key={idx} className="flex items-center gap-3 cursor-pointer group">
                                        <div className={`w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center group-hover:border-yellow-600 ${formData[fieldId] === opt ? 'border-yellow-600' : ''}`}>
                                            {formData[fieldId] === opt && <div className="w-2 h-2 bg-yellow-600 rounded-full"></div>}
                                        </div>
                                        <input 
                                            type="radio" 
                                            name={fieldId} 
                                            value={opt}
                                            checked={formData[fieldId] === opt}
                                            onChange={() => handleInputChange(fieldId, opt)}
                                            className="hidden"
                                        />
                                        <span className={`text-sm ${formData[fieldId] === opt ? 'text-yellow-500' : 'text-stone-500 group-hover:text-stone-300'}`}>{opt}</span>
                                    </label>
                                ))}
                            </div>
                        )}

                        {field.type === 'checkbox' && field.options && (
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-2">
                                {field.options.map((opt, idx) => {
                                    const isSelected = (formData[fieldId] || []).includes(opt);
                                    return (
                                        <label key={idx} className="flex items-center gap-3 cursor-pointer group bg-stone-900/30 p-2 rounded hover:bg-stone-900/60 transition-colors">
                                            <div className={`w-4 h-4 rounded border border-stone-600 flex items-center justify-center ${isSelected ? 'bg-yellow-900 border-yellow-700' : ''}`}>
                                                {isSelected && <span className="text-xs text-yellow-200">✓</span>}
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={isSelected}
                                                onChange={() => handleCheckboxChange(fieldId, opt, field.max_select || 99)}
                                                className="hidden"
                                            />
                                            <span className={`text-sm ${isSelected ? 'text-yellow-200' : 'text-stone-500'}`}>{opt}</span>
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
                    className="w-full mt-4 bg-yellow-900/20 hover:bg-yellow-900/40 border border-yellow-900/50 text-yellow-500 font-bold py-3 rounded uppercase tracking-widest transition-all hover:scale-[1.01]"
                >
                    {isSubmitting ? "Enviando..." : "Confirmar Ficha"}
                </button>
             </form>
        </div>
    );
}
export default DynamicForm;