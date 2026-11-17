import { createContext } from "react";

export default createContext({ canEdit: false, revision: 0, refresh: async () => {} });
