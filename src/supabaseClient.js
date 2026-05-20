import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://olodhezrymoxzgddkguc.supabase.co";
const supabaseAnonKey = "sb_publishable__YTbb4wN1AJqJm3XSiftlQ_WyTM3JfZ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);