-- Client.birthday — fecha opcional para cumpleaños.
-- Sin año obligatorio en la UI, pero se guarda fecha completa porque
-- <input type="date"> lo exige y facilita el orden por mes/día.
ALTER TABLE "Client" ADD COLUMN "birthday" DATE;
