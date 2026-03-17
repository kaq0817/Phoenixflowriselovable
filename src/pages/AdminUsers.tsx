import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Users, Store, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Navigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  roles: string[];
  store_count: number;
}

export default function AdminUsers() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Get all profiles
      const { data: profiles, error: profilesErr } = await supabase
        .from("profiles")
        .select("id, email, full_name, created_at")
        .order("created_at", { ascending: false });

      if (profilesErr) throw profilesErr;

      // Get all roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");

      // Get store connection counts
      const { data: stores } = await supabase
        .from("store_connections")
        .select("user_id");

      const storeCounts: Record<string, number> = {};
      stores?.forEach((s) => {
        storeCounts[s.user_id] = (storeCounts[s.user_id] || 0) + 1;
      });

      const roleMap: Record<string, string[]> = {};
      roles?.forEach((r) => {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
        roleMap[r.user_id].push(r.role);
      });

      setUsers(
        (profiles || []).map((p) => ({
          ...p,
          roles: roleMap[p.id] || [],
          store_count: storeCounts[p.id] || 0,
        }))
      );
    } catch (err: any) {
      toast({ title: "Error loading users", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingRole(userId);
    try {
      // Remove existing roles for this user
      const { error: deleteErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);

      if (deleteErr) throw deleteErr;

      // Insert new role if not "none"
      if (newRole !== "none") {
        const { error: insertErr } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: newRole as any });

        if (insertErr) throw insertErr;
      }

      toast({ title: "Role updated" });
      fetchUsers();
    } catch (err: any) {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingRole(null);
    }
  };

  if (!isAdmin && !loading) {
    return <Navigate to="/" replace />;
  }

  const filtered = users.filter(
    (u) =>
      (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.full_name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" /> Admin — User Management
        </h1>
        <p className="text-muted-foreground mt-1">
          View all users, their connected stores, and manage roles.
        </p>
      </motion.div>

      <Card className="bg-card/50 border-border/30">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span className="font-semibold">{users.length} Users</span>
            </div>
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email or name..."
                className="pl-9 bg-muted/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-border/30">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Stores</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{u.full_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Store className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{u.store_count}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.roles.length > 0 ? (
                          u.roles.map((r) => (
                            <Badge
                              key={r}
                              variant={r === "admin" ? "default" : "secondary"}
                              className="mr-1"
                            >
                              {r}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">user</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {updatingRole === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Select
                            value={u.roles[0] || "none"}
                            onValueChange={(val) => handleRoleChange(u.id, val)}
                          >
                            <SelectTrigger className="w-[120px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No role</SelectItem>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="moderator">Moderator</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No users found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
