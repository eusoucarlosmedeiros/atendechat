// Tipo decorativo opcional usado em Session = WASocket & { store?: Store }.
// Mantido como interface vazia/extensivel; o sistema atual nao instancia store
// (a Baileys 6.17+ removeu makeInMemoryStore). Mantemos o tipo para nao
// quebrar codigo legado que tipa "store" como propriedade opcional.
export interface Store {
  // Campos opcionais — o codigo nao acessa nenhum deles em runtime atualmente.
  // Caso volte a usar makeInMemoryStore, redefina este tipo com a forma
  // adequada ou importe diretamente de "baileys".
  [key: string]: unknown;
}
