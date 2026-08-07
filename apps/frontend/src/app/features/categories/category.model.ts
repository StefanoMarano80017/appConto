/** Categoria di spesa, così come viene esposta dalle API del backend. */
export interface Category {
  id: string;
  name: string;
  color: string | null;
}
