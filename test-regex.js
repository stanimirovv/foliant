const regex = /^\s*([A-Za-z0-9_-]+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->|--|-)\s*([A-Za-z0-9_-]+)(?:\s*:|\s*$)/;
console.log(regex.exec("  MergedKey_backend->>MergedKey_backend: Fetch User Data"));
console.log(regex.exec("  MergedKey_backend-->>MergedKey_backend: Fetch User Data"));
