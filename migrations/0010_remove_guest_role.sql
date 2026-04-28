-- Eliminar rol 'guest': convertir todos los usuarios con role='guest' a 'player'
-- Solo existen dos roles: 'admin' y 'player' (más 'suspended' para cuentas bloqueadas)
UPDATE users SET role = 'player' WHERE role = 'guest';
