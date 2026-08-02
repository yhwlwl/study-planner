declare namespace JSX { interface IntrinsicAttributes { key?: any } interface IntrinsicElements { [elemName: string]: any } }
declare namespace React { type ReactNode = any; interface DragEvent<T = any> { preventDefault(): void; stopPropagation(): void; dataTransfer: any; target: T; currentTarget: T } interface MouseEvent<T = any> { preventDefault(): void; stopPropagation(): void; target: T; currentTarget: T } interface TouchEvent<T = any> { touches: any; changedTouches: any; target: T; currentTarget: T } }
declare module 'react' {
  export type ReactNode = any
  export type ReactElement<P = any> = { props: P; key?: any; type?: any }
  export const Children: { toArray(children: any): any[] }
  export function cloneElement(element: any, props?: any, ...children: any[]): any
  export function isValidElement(node: any): boolean
  export type CSSProperties = Record<string, string | number | undefined>
  export const StrictMode: any
  export type DragEvent<T = any> = React.DragEvent<T>; export type MouseEvent<T = any> = React.MouseEvent<T>; export type TouchEvent<T = any> = React.TouchEvent<T>
  export function useState<T>(): [T | undefined, (value: T | undefined | ((prev: T | undefined) => T | undefined)) => void]
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T
  export function useRef<T>(): { current: T | undefined }
  export function useRef<T>(initial: T): { current: T }
  export function useRef<T>(initial: null): { current: T | null }
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly any[]): T
  export function createContext<T>(initial: T): any
  export function useContext<T = any>(ctx: any): any
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any }
declare module 'react-dom/client' { export function createRoot(node: any): { render(node: any): void } }
declare module '@supabase/supabase-js' {
  export interface Session { user: { id: string; email?: string } }
  export type SupabaseClient = any
  export function createClient(url: string, key: string): any
}
declare module 'lucide-react' {
  export const Activity:any; export const AlertTriangle:any; export const ChevronDown:any; export const ChevronUp:any; export const Undo2:any; export const BarChart3:any; export const CalendarClock:any; export const CalendarDays:any; export const Check:any; export const CheckCircle2:any; export const Flame:any; export const Focus:any; export const ChevronLeft:any; export const ChevronRight:any; export const Clock3:any; export const Cloud:any; export const CloudOff:any; export const Download:any; export const Ellipsis:any; export const FileDown:any; export const Filter:any; export const LayoutDashboard:any; export const ListTodo:any; export const Lock:any; export const Maximize2:any; export const Menu:any; export const Pause:any; export const Play:any; export const Plus:any; export const RefreshCw:any; export const RotateCcw:any; export const Search:any; export const Settings:any; export const SlidersHorizontal:any; export const Sparkles:any; export const Table2:any; export const Target:any; export const TrendingUp:any; export const Trash2:any; export const Unlock:any; export const Upload:any; export const X:any
}
declare module 'recharts' { export const Bar:any; export const BarChart:any; export const CartesianGrid:any; export const ComposedChart:any; export const Legend:any; export const Line:any; export const LineChart:any; export const Pie:any; export const PieChart:any; export const Cell:any; export const ResponsiveContainer:any; export const Tooltip:any; export const XAxis:any; export const YAxis:any }
declare module 'date-fns' {
  export function addDays(d:any,n:number):Date; export function addMonths(d:any,n:number):Date; export function differenceInCalendarDays(a:any,b:any):number; export function eachDayOfInterval(x:any):Date[]; export function endOfMonth(d:any):Date; export function format(d:any,p:string):string; export function getDay(d:any):number; export function isAfter(a:any,b:any):boolean; export function isBefore(a:any,b:any):boolean; export function isWithinInterval(d:any,x:any):boolean; export function parseISO(s:string):Date; export function startOfMonth(d:any):Date
}
declare module 'idb' { export function openDB(name:string,version:number,options:any):Promise<any> }
interface ImportMetaEnv { [key: string]: any }
interface ImportMeta { readonly env: ImportMetaEnv }

declare module 'virtual:pwa-register' { export function registerSW(options?: any): any }
