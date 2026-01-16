import {useQuery} from '@tanstack/react-query'


export const useAIModels = () => {
    return useQuery({
        queryKey: ['ai-models'],
        queryFn: async () => {
            const res = await fetch('/api/ai/get-models');
            return res.json();
        },
    })
}
