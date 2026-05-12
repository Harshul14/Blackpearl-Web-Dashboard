import { useQueryClient } from "@tanstack/react-query";
import React from "react"; // 6.9k (gzipped: 2.7k)

const useRefetch = () => {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.refetchQueries({
      type: "active",
    });
  };
};

export default useRefetch;

