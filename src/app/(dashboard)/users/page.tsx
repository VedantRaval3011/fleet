"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Loader2, Edit2, Trash2, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({ name: "", email: "", username: "", password: "", role: "driver" });
  const [isCreating, setIsCreating] = useState(false);

  // Edit / Delete states
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({ name: "", email: "", username: "", password: "", role: "" });
  const [isUpdating, setIsUpdating] = useState(false);
  
  const [deletingUser, setDeletingUser] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        fetchUsers();
        setFormData({ name: "", email: "", username: "", password: "", role: "driver" });
      } else {
        const data = await res.json();
        alert(data.error || "Failed to create user");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const openEditModal = (user: any) => {
    setEditingUser(user);
    setEditFormData({ 
      name: user.name, 
      email: user.email, 
      username: user.username || "", 
      password: "", // Intentionally blank, only sent if typed
      role: user.role 
    });
  };

  const updateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: editingUser._id,
          ...editFormData
        }),
      });
      if (res.ok) {
        setEditingUser(null);
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update user");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteUser = async () => {
    if (!deletingUser) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/users?id=${deletingUser._id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setDeletingUser(null);
        fetchUsers();
      } else {
         const data = await res.json();
         alert(data.error || "Failed to delete user");
      }
    } catch (error) {
       console.error(error);
    } finally {
       setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">User Management</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Create User Form */}
        <Card className="md:col-span-1 bg-slate-900 border-slate-800 text-slate-100 h-fit">
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-4 text-white">Create User</h2>
            <form onSubmit={createUser} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Full Name</label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="bg-slate-950 border-slate-700" placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Username (Optional)</label>
                <Input value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="bg-slate-950 border-slate-700" placeholder="johndoe123" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Email</label>
                <Input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="bg-slate-950 border-slate-700" placeholder="john@company.com" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Password</label>
                <Input required type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="bg-slate-950 border-slate-700" placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Role</label>
                <Select value={formData.role} onValueChange={v => setFormData({...formData, role: v})}>
                  <SelectTrigger className="bg-slate-950 border-slate-700">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="driver">Driver</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={isCreating} className="w-full bg-indigo-600 hover:bg-indigo-700">
                {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Add User
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* User List */}
        <Card className="md:col-span-2 bg-slate-900 border-slate-800 text-slate-100">
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-400">Name</TableHead>
                <TableHead className="text-slate-400">Username / Email</TableHead>
                <TableHead className="text-slate-400">Role</TableHead>
                <TableHead className="text-slate-400">Joined</TableHead>
                <TableHead className="text-slate-400 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : users.map(user => (
                <TableRow key={user._id} className="border-slate-800">
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-slate-400">
                    {user.username && <span className="font-medium text-indigo-300 block">@{user.username}</span>}
                    <span className="text-xs text-slate-500">{user.email}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={user.role === 'admin' ? "border-amber-500 text-amber-500" : "border-indigo-500 text-indigo-500"}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400">{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                     <div className="flex justify-end gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 w-8 p-0 border-slate-700 hover:bg-slate-800 hover:text-indigo-400"
                          onClick={() => openEditModal(user)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 w-8 p-0 border-slate-700 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/50"
                          onClick={() => setDeletingUser(user)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                     </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Edit User Modal */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription className="text-slate-400">
              Make changes to {editFormData.name}&apos;s profile here.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={updateUser} className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Full Name</label>
              <Input required value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="bg-slate-950 border-slate-700" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Username</label>
              <Input value={editFormData.username} onChange={e => setEditFormData({...editFormData, username: e.target.value})} className="bg-slate-950 border-slate-700" placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Email</label>
              <Input required type="email" value={editFormData.email} onChange={e => setEditFormData({...editFormData, email: e.target.value})} className="bg-slate-950 border-slate-700" />
            </div>
            <div className="space-y-2">
               <label className="text-sm font-medium text-slate-300">New Password (Optional)</label>
               <Input type="password" value={editFormData.password} onChange={e => setEditFormData({...editFormData, password: e.target.value})} className="bg-slate-950 border-slate-700" placeholder="Leave blank to keep current" />
            </div>
            <div className="space-y-2">
               <label className="text-sm font-medium text-slate-300">Role</label>
               <Select value={editFormData.role} onValueChange={v => setEditFormData({...editFormData, role: v})}>
                 <SelectTrigger className="bg-slate-950 border-slate-700">
                   <SelectValue placeholder="Select a role" />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="admin">Admin</SelectItem>
                   <SelectItem value="driver">Driver</SelectItem>
                 </SelectContent>
               </Select>
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setEditingUser(null)} className="hover:bg-slate-800 text-slate-300">Cancel</Button>
              <Button type="submit" disabled={isUpdating} className="bg-indigo-600 hover:bg-indigo-700">
                 {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                 Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent className="bg-slate-900 border-rose-500/20 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center text-rose-500">
              <ShieldAlert className="w-5 h-5 mr-2" /> Delete User
            </DialogTitle>
            <DialogDescription className="text-slate-400 pt-2 pb-4">
               Are you completely sure you want to delete <strong className="text-slate-200">{deletingUser?.name}</strong>? 
               <br/><br/>
               If they are a driver, their ongoing portal access will be permanently revoked. However, for auditing purposes, their historical Expenses and Call Logs will remain safely stored. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
             <Button variant="outline" onClick={() => setDeletingUser(null)} className="border-slate-700 hover:bg-slate-800 text-slate-300">Cancel</Button>
             <Button variant="destructive" onClick={deleteUser} disabled={isDeleting} className="bg-rose-600 hover:bg-rose-700">
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete user"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
