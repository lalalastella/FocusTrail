const style = document.createElement('style');
style.textContent = `
  @keyframes slide-right { from { transform: translateX(-20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes slide-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fade-in-up { from { transform: translate(-50%, 20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
  @keyframes slide { 0% { background-position: 0 0; } 100% { background-position: 20px 20px; } }
  
  .animate-slide-right { animation: slide-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-slide-up { animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
  .animate-fade-in-up { animation: fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  
  .writing-vertical-rl { writing-mode: vertical-rl; text-orientation: mixed; }
  
  .custom-scrollbar::-webkit-scrollbar { width: 4px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.3); border-radius: 4px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.5); }
`;
document.head.appendChild(style);
